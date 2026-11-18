/**
 * HTTP-транспорт MCP-сервера: StreamableHTTPServerTransport поверх
 * node:http в stateless-режиме.
 *
 * АВТОРИЗАЦИЯ (ДО создания сервера): заголовок
 *   Authorization: Bearer <токен сессии кабинета>
 * Токен проверяется боевым validateSession ядра НА КАЖДЫЙ запрос:
 *   - заголовка нет → 401, JSON-RPC error -32001;
 *   - сессия мертва  → 401, JSON-RPC error -32002.
 * Сервер (McpServer + транспорт) создаётся ПОСЛЕ проверки токена:
 * неавторизованный запрос не поднимает никаких объектов сервера.
 *
 * ПОЧЕМУ STATELESS: у MCP-сервера деканата нет собственного состояния
 * между запросами — вся Authorisation на каждый вызов, поэтому сервер
 * можно создавать на запрос (так рекомендует спецификация для
 * stateless-режима) и масштабировать горизонтально.
 *
 * ЗДОРОВЬЕ: GET /healthz → 200 {"ok":true} БЕЗ авторизации (проверка
 * доступности процесса, данных не отдаёт).
 *
 * DNS-REBINDING: allowedHosts включён (localhost и адрес привязки по
 * умолчанию) — браузер не сможет заставить локальный сервер отвечать
 * на запросы со стороннего домена.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateSession } from '@udgu/core';
import { createDeaneryServer, type ServerLog } from './server.js';
import { sessionInvalidError, sessionRequiredError } from './errors.js';
import { ensureDatabaseUrlFromRootEnv } from './env.js';

/** Диагностика в stderr: stdout не занят протоколом, но логи туда же. */
const log: ServerLog = (message) => {
  process.stderr.write(`[udgu-mcp] ${message}\n`);
};

/** Порт HTTP по умолчанию. */
const DEFAULT_HTTP_PORT = 8787;

/** Хост привязки по умолчанию: только локальный интерфейс. */
const DEFAULT_HTTP_HOST = '127.0.0.1';

/** Максимальный размер тела запроса (JSON-RPC), байт. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Путь проверки здоровья (без авторизации). */
const HEALTH_PATH = '/healthz';

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
}

/** Порт из env: MCP_HTTP_PORT, иначе 8787 (некорректное значение → дефолт). */
export function httpPortFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MCP_HTTP_PORT;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_HTTP_PORT;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_HTTP_PORT;
  }
  return parsed;
}

/** Хост привязки из env: MCP_HTTP_HOST, иначе 127.0.0.1. */
export function httpHostFromEnv(env: Record<string, string | undefined> = process.env): string {
  const raw = env.MCP_HTTP_HOST;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_HTTP_HOST;
  }
  return raw.trim();
}

/**
 * Список разрешённых Host/Origin для DNS-rebinding защиты.
 *
 * По умолчанию: localhost (с портом и без) + хост привязки (с портом и
 * без). Переопределяется через MCP_HTTP_ALLOWED_HOSTS /
 * MCP_HTTP_ALLOWED_ORIGINS (список через запятую) — например, когда
 * сервер опубликован за обратным прокси.
 */
function allowedList(
  env: Record<string, string | undefined>,
  envName: string,
  host: string,
  port: number,
): string[] {
  const raw = env[envName];
  if (raw !== undefined && raw.trim() !== '') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  const variants = new Set<string>([
    'localhost',
    `localhost:${port}`,
    host,
    `${host}:${port}`,
    '127.0.0.1',
    `127.0.0.1:${port}`,
  ]);
  return [...variants];
}

/** Конфигурация HTTP-слоя из окружения. */
export function httpConfigFromEnv(env: Record<string, string | undefined> = process.env): HttpConfig {
  const host = httpHostFromEnv(env);
  const port = httpPortFromEnv(env);
  return {
    host,
    port,
    allowedHosts: allowedList(env, 'MCP_HTTP_ALLOWED_HOSTS', host, port),
    allowedOrigins: allowedList(env, 'MCP_HTTP_ALLOWED_ORIGINS', host, port),
  };
}

/** Достаёт токен из заголовка Authorization: Bearer <токен>. */
export function bearerToken(header: string | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) {
    return null;
  }
  const token = match[1]?.trim() ?? '';
  return token === '' ? null : token;
}

/** JSON-RPC error ответом (идентификатор неизвестен — null). */
function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  const body = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } });
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** JSON ответ (healthz). */
function jsonResponse(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/**
 * Читает тело запроса ЦЕЛИКОМ и разбирает JSON один раз.
 *
 * Возвращает:
 * - { ok: true, body } — разобранный JSON-RPC (объект или массив);
 * - { ok: false, status, code, message } — отказ до создания сервера.
 */
async function readJsonBody(
  req: IncomingMessage,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; status: number; code: number; message: string }
> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      size += buffer.byteLength;
      if (size > MAX_BODY_BYTES) {
        // Прерываем чтение и сливаем остаток: иначе keep-alive
        // соединение зависнет на недокачанном теле.
        drainBody(req);
        return { ok: false, status: 413, code: -32000, message: 'Тело запроса слишком большое.' };
      }
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, status: 400, code: -32700, message: 'Не удалось прочитать тело запроса.' };
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') {
    return { ok: false, status: 400, code: -32700, message: 'Пустое тело запроса.' };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, code: -32700, message: 'Не удалось разобрать JSON тела запроса.' };
  }
}

/** Сливает неиспользованное тело, чтобы keep-alive соединение осталось рабочим. */
function drainBody(req: IncomingMessage): void {
  req.resume();
}

/**
 * Поднимает HTTP-сервер MCP на node:http.
 *
 * Порядок на запрос: /healthz → токен (401 при отказе) → тело →
 * сервер + транспорт → transport.handleRequest.
 */
export async function serveOverHttp(): Promise<void> {
  // Дефект волны A в координатах HTTP: оператор запускает
  // mcp:serve:http из своего окружения, где может не быть DATABASE_URL
  // (его даёт только Next.js). Корневой .env подхватывается по
  // расположению кода — путь не зависит от рабочего каталога.
  ensureDatabaseUrlFromRootEnv();

  const config = httpConfigFromEnv();

  const server = createServer((req, res) => {
    void handleHttpRequest(req, res, config).catch((error: unknown) => {
      log(`HTTP: необработанная ошибка: ${String(error)}`);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, 'Внутренняя ошибка сервера. Попробуйте позже.');
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => resolve());
  });

  const address = server.address();
  const bound =
    typeof address === 'object' && address !== null
      ? `${address.address}:${address.port}`
      : `${config.host}:${config.port}`;
  log(
    `MCP-сервер деканата УдГУ: HTTP ${bound} (stateless), ` +
      `токен сессии — из заголовка Authorization: Bearer`,
  );

  const shutdown = (reason: string): void => {
    log(reason);
    server.close(() => process.exit(0));
    // Если соединения держатся (SSE keep-alive), не зависаем навсегда.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('получен SIGINT — сервер завершает работу'));
  process.on('SIGTERM', () => shutdown('получен SIGTERM — сервер завершает работу'));
}

/** Один HTTP-запрос: здоровье → авторизация → сервер на запрос. */
async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: HttpConfig,
): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  // Здоровье: без авторизации и без данных.
  if (req.method === 'GET' && path === HEALTH_PATH) {
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // Авторизация ДО создания сервера: неавторизованный запрос не
  // поднимает McpServer и транспорт.
  const token = bearerToken(req.headers.authorization);
  if (token === null) {
    drainBody(req);
    const error = sessionRequiredError();
    log(`HTTP ${req.method ?? '?'} ${path}: 401 — ${error.message}`);
    jsonRpcError(res, 401, -32001, error.message);
    return;
  }

  let authorized = false;
  try {
    authorized = (await validateSession(token)) !== null;
  } catch (error) {
    // Сбой доступа к базе — не ошибка токена: 500, а не 401.
    drainBody(req);
    log(`HTTP ${req.method ?? '?'} ${path}: сбой проверки сессии: ${String(error)}`);
    jsonRpcError(res, 500, -32603, 'Внутренняя ошибка сервера. Попробуйте позже.');
    return;
  }
  if (!authorized) {
    drainBody(req);
    const error = sessionInvalidError();
    log(`HTTP ${req.method ?? '?'} ${path}: 401 — ${error.message}`);
    jsonRpcError(res, 401, -32002, error.message);
    return;
  }

  // Тело парсится ОДИН раз и передаётся в транспорт как есть.
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    jsonRpcError(res, parsed.status, parsed.code, parsed.message);
    return;
  }

  // Сервер и транспорт — на запрос (stateless): состояния между
  // запросами нет, авторизация на каждый вызов.
  const server = createDeaneryServer({
    resolveToken: () => token,
    log,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: [...config.allowedHosts],
    allowedOrigins: [...config.allowedOrigins],
  });
  transport.onerror = (error) => {
    log(`HTTP транспорт: ${error.message}`);
  };

  res.on('close', () => {
    void server.close().catch(() => undefined);
    void transport.close().catch(() => undefined);
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, parsed.body);
}

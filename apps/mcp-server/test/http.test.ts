/**
 * Живой HTTP: сервер поднимается РЕАЛЬНЫМ дочерним процессом
 * (src/index.ts --transport http) на ephemeral-порту, и с ним говорит
 * SDK-клиент (StreamableHTTPClientTransport).
 *
 * Проверяемые инварианты (спека PO):
 *   - initialize + tools/call с Authorization: Bearer <токен сессии> →
 *     200 и РЕАЛЬНЫЙ результат из базы;
 *   - без заголовка Authorization → 401 с JSON-RPC error -32001;
 *   - с недействительным токеном → 401 с JSON-RPC error -32002;
 *   - GET /healthz → 200 {"ok":true} БЕЗ авторизации;
 *   - DNS-rebinding: чужой Host → 403 (защита включена).
 *
 * Изолированная тестовая БД: прод-база (horizon) тестами не трогается.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  closeTestDb,
  createFixtures,
  ensureIsolatedDatabase,
  ensureStorageDir,
  type McpFixtures,
} from './fixtures.js';

const mcpServerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const indexEntry = path.join(mcpServerDir, 'src', 'index.ts');
const tsxLoader = path.resolve(mcpServerDir, '../../node_modules/tsx/dist/loader.mjs');

let fixtures: McpFixtures;
let child: ReturnType<typeof spawn> | undefined;
let baseUrl = '';
let stderrText = '';

/** Свободный порт ОС: закрываем сразу, сервер поднимется на нём. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test.before(async () => {
  const databaseUrl = await ensureIsolatedDatabase();
  fixtures = await createFixtures();
  const storageDir = await ensureStorageDir();
  const port = await freePort();

  child = spawn(process.execPath, ['--import', tsxLoader, indexEntry, '--transport', 'http'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      STORAGE_DIR: storageDir,
      MCP_TRANSPORT: 'http',
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrText += chunk;
  });

  baseUrl = `http://127.0.0.1:${port}`;
  // Ждём готовности: /healthz отвечает без авторизации.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        break;
      }
    } catch {
      // Сервер ещё поднимается.
    }
    if (Date.now() > deadline) {
      throw new Error(`HTTP-сервер не поднялся за 30с. stderr: ${stderrText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

test.after(async () => {
  child?.kill('SIGTERM');
  child = undefined;
  await closeTestDb();
});

/** JSON-RPC запрос «как у агента»: initialize с полными заголовками MCP. */
function initializeRequest(): { jsonrpc: '2.0'; id: number; method: 'initialize'; params: unknown } {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'udgu-mcp-http-test', version: '1.0.0' },
    },
  };
}

/** POST с произвольным Host (браузерный fetch так не умеет). */
function postWithHost(host: string, authorization: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/mcp`);
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization,
          host,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(initializeRequest()));
  });
}

test('healthz: 200 без авторизации', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('без заголовка Authorization → 401 (-32001)', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(initializeRequest()),
  });
  assert.equal(response.status, 401, 'неавторизованный запрос не доходит до сервера');
  const payload = (await response.json()) as { error: { code: number; message: string } };
  assert.equal(payload.error.code, -32001);
  assert.match(payload.error.message, /токен/i, 'человеческий текст про токен');
});

test('недействительный токен → 401 (-32002)', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer bogus-session-token',
    },
    body: JSON.stringify(initializeRequest()),
  });
  assert.equal(response.status, 401);
  const payload = (await response.json()) as { error: { code: number; message: string } };
  assert.equal(payload.error.code, -32002);
  assert.match(payload.error.message, /[Сс]ессия/, 'человеческий текст про мёртвую сессию');
});

test('DNS-rebinding: чужой Host → 403 (защита включена)', async () => {
  // Через node:http, а не fetch: браузерный fetch не даёт подменить Host,
  // а DNS-rebinding — именно браузерная атака.
  const status = await postWithHost('evil.example.com', `Bearer ${fixtures.staffToken}`);
  assert.equal(status, 403, 'запрос с чужим Host отклонён до создания сервера');
});

test('initialize + tools/list + tools/call с Bearer → 200 и реальные данные', async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${fixtures.staffToken}` } },
  });
  const client = new Client({ name: 'udgu-mcp-http-test', version: '1.0.0' });
  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.equal(tools.tools.length, 11, 'набор инструментов по спеке');
    assert.ok(
      tools.tools.some((tool) => tool.name === 'get_schedule'),
      'инструменты кабинета сотрудника доступны',
    );

    const result = await client.callTool({ name: 'list_requests', arguments: {} });
    assert.notEqual(result.isError, true, 'вызов от имени сотрудника проходит');
    const structured = result.structuredContent as { items: { id: string; student: { faculty: string } }[] };
    const queue = structured.items;
    assert.equal(queue.length, 1, 'очередь заявок своего института из базы');
    assert.equal(queue[0]?.id, fixtures.ownRequestId);
    assert.equal(queue[0]?.student.faculty, 'Институт математики, информационных технологий и физики');
  } finally {
    await client.close();
  }

  // Токен сессии равносилен паролю: в логах процесса его нет.
  assert.ok(!stderrText.includes(fixtures.staffToken), 'токена нет в stderr сервера');
  assert.ok(!stderrText.includes('DATABASE_URL'), 'строки подключения нет в stderr сервера');
});

test('healthz не требует авторизации даже при мёртвом токене в окружении процесса', async () => {
  const response = await fetch(`${baseUrl}/healthz`, {
    headers: { authorization: 'Bearer definitely-bogus-token' },
  });
  assert.equal(response.status, 200);
});

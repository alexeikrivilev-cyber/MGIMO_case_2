/**
 * Сервер MCP на официальном SDK: createDeaneryServer собирает McpServer
 * и регистрирует инструменты кабинета сотрудника деканата.
 *
 * СВОИХ ПРАВИЛ ДОСТУПА У СЕРВЕРА НЕТ. Он резолвит сессию по токену и
 * вызывает инструмент, а инструмент — сервис кабинета. Все проверки
 * (роль, факультет, владение данными) живут в packages/core: если бы
 * правила дублировались здесь, кабинет и MCP разошлись бы при первой
 * же правке.
 *
 * АВТОРИЗАЦИЯ НА КАЖДЫЙ ВЫЗОВ: resolveToken → validateSession →
 * requireStaffScope, без кеширования (см. session.ts). Отзыв сессии
 * отключает агента сразу.
 *
 * ЕДИНЫЙ ШЛЮЗ ПРАВ: MCP-сервер — кабинет СОТРУДНИКА деканата, поэтому
 * доступ к нему целиком — STAFF/ADMIN. Шлюз стоит здесь, одним местом,
 * и реализован ФУНКЦИЕЙ ЯДРА (requireStaffScope), а не своим правилом:
 * кабинет и MCP не могут разойтись в понимании «кто сотрудник».
 * Дальше каждый инструмент вызывает сервис кабинета, который проверяет
 * уже владение данными (свой институт / все у ADMIN).
 *
 * ОШИБКИ ИНСТРУМЕНТОВ — ЧЕРЕЗ result.isError (рекомендация спецификации
 * MCP), а не через JSON-RPC error: нет токена, мёртвая сессия, отказ
 * ядра по правам или бизнес-правилу. JSON-RPC error остаётся за
 * транспортным слоем (HTTP: 401 до создания сервера).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requireStaffScope, type AuthSession } from '@udgu/core';
import { DEANERY_TOOLS } from './tools.js';
import { requireSession } from './session.js';
import { isUnexpectedError, toolErrorMessage } from './errors.js';

/** Логгер сервера: пишет ТОЛЬКО в stderr (stdout — канал протокола). */
export type ServerLog = (message: string) => void;

/** Имя и версия сервера для initialize (serverInfo). */
export const SERVER_NAME = 'udgu-deanery-mcp';
export const SERVER_VERSION = '0.1.0';

/** Инструкция агенту: что это за сервер и с какими данными он работает. */
export const SERVER_INSTRUCTIONS =
  'MCP-сервер кабинета сотрудника деканата УдГУ (учебный прототип, данные синтетические). ' +
  'Инструменты работают от сессии сотрудника деканата или администратора: ' +
  'сотрудник видит только свой институт, администратор — все. ' +
  'Каждый инструмент возвращает те же данные, что и соответствующий раздел кабинета.';

export interface DeaneryServerOptions {
  /** Откуда взять токен сессии: env (stdio) или заголовок (HTTP). */
  readonly resolveToken: () => string | null;
  /** Диагностика в stderr; по умолчанию молчание. */
  readonly log?: ServerLog;
}

/**
 * Собирает McpServer с инструментами деканата.
 *
 * Транспорт подключается снаружи (stdio.ts / http.ts): сервер не знает,
 * откуда пришёл запрос, — это и позволяет держать два транспорта на
 * одном наборе инструментов.
 */
export function createDeaneryServer(options: DeaneryServerOptions): McpServer {
  const log = options.log ?? (() => undefined);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: 'Деканат УдГУ (MCP)' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of DEANERY_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Zod-схема инструмента: SDK проверяет аргументы (некорректные →
        // isError) и строит по ней inputSchema для tools/list.
        inputSchema: tool.schema,
      },
      async (args: unknown) => {
        let session: AuthSession;
        try {
          // resolveToken + validateSession + requireStaffScope на КАЖДЫЙ
          // вызов: без кеширования. Все три проверки — функции ядра.
          session = await requireSession(options.resolveToken());
          requireStaffScope(session);
        } catch (error) {
          return errorResult(error, log, tool.name);
        }

        try {
          const data = await tool.handler(session, args as Record<string, unknown>);
          log(`tools/call ${tool.name}: готово (пользователь ${session.user.login})`);
          return {
            content: [{ type: 'text', text: stringifyData(data) }],
            // structuredContent по спецификации MCP — объект: массив
            // (очередь заявок, расписание) кладём в items, иначе клиент
            // отбросит результат как невалидный.
            structuredContent: structuredOf(data),
          };
        } catch (error) {
          return errorResult(error, log, tool.name);
        }
      },
    );
  }

  return server;
}

/**
 * Результат-отказ инструмента: человеческий текст + isError.
 *
 * Неожиданные сбои (не отказ ядра и не авторизация) подробно — в
 * stderr, клиенту — только обезличенный текст.
 */
function errorResult(
  error: unknown,
  log: ServerLog,
  toolName: string,
): { content: { type: 'text'; text: string }[]; isError: true } {
  if (isUnexpectedError(error)) {
    log(`tools/call ${toolName}: необработанная ошибка: ${String(error)}`);
  }
  return {
    content: [{ type: 'text', text: toolErrorMessage(error) }],
    isError: true,
  };
}

/** JSON-сериализация данных инструмента (даты → ISO). */
function stringifyData(data: unknown): string {
  return JSON.stringify(data, (_key, value) => (value instanceof Date ? value.toISOString() : value), 2);
}

/**
 * structuredContent инструмента: объект по спецификации MCP.
 *
 * Сервисы кабинета возвращают массивы (очередь, расписание, болезни) и
 * объекты (успеваемость, карточка преподавателя). Массив кладём в
 * items — текстовый content при этом несёт данные без обёртки, поэтому
 * «сырые» данные доступны агенту и там.
 */
function structuredOf(data: unknown): Record<string, unknown> {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { items: data };
}

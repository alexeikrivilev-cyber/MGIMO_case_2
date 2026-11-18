/**
 * Сервер MCP: разбор JSON-RPC, методы initialize / tools/list /
 * tools/call / ping, отображение ошибок ядра в ошибки протокола.
 *
 * СЕРВЕР НЕ ЗНАЕТ ПРАВИЛ ДОСТУПА. Он резолвит сессию (SessionContext) и
 * вызывает инструмент, а инструмент — сервис кабинета. Все проверки
 * (STAFF/ADMIN, факультет, владение данными) живут в packages/core:
 * если бы правила были здесь, кабинет и MCP разошлись бы при первой же
 * правке.
 *
 * АВТОРИЗАЦИЯ:
 *   - initialize и tools/list требуют ВАЛИДНУЮ сессию (любую роль):
 *     без токена — отказ SESSION_REQUIRED, с мёртвым токеном —
 *     SESSION_INVALID;
 *   - tools/call требует сессию и права инструмента: отказ по роли или
 *     владению приходит от ядра как FORBIDDEN.
 *     Токен студента поэтому проходит initialize, но любой deanery_*
 *     вызов завершается отказом — это и проверяется в тестах.
 */
import { DEANERY_TOOLS, findDeaneryTool, inputSchemaOf } from './tools';
import { McpError, toMcpError } from './errors';
import { SessionContext } from './session';
import {
  JSON_RPC_ERROR,
  PROTOCOL_VERSION,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
  decodeMessage,
  encodeMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  jsonRpcError,
  jsonRpcResult,
  stringifyJson,
  type JsonRpcId,
  type JsonRpcResponse,
} from './protocol';

/** Логгер сервера: пишет ТОЛЬКО в stderr (stdout — канал протокола). */
export type ServerLog = (message: string) => void;

export interface DeaneryServerOptions {
  readonly sessions: SessionContext;
  readonly log?: ServerLog;
}

/** Ответ инструмента в формате MCP: текст + структурированные данные. */
interface ToolCallResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent: unknown;
}

export class DeaneryMcpServer {
  readonly #sessions: SessionContext;
  readonly #log: ServerLog;

  constructor(options: DeaneryServerOptions) {
    this.#sessions = options.sessions;
    this.#log = options.log ?? (() => undefined);
  }

  /**
   * Обрабатывает ОДНО сообщение транспорта.
   *
   * Возвращает:
   * - JsonRpcResponse — на запрос (в том числе на ошибочный);
   * - null — на уведомление (ответ по протоколу не отсылается) или на
   *   сообщение, которое не является ни запросом, ни уведомлением.
   */
  async handle(raw: unknown): Promise<JsonRpcResponse | null> {
    if (Array.isArray(raw)) {
      // Пакетная отправка в MCP не используется: отвечаем отказом, а не
      // молчанием, иначе клиент зависнет на таймауте.
      return jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, 'Пакетные сообщения не поддерживаются.');
    }

    if (isJsonRpcRequest(raw)) {
      return this.#handleRequest(raw);
    }

    if (isJsonRpcNotification(raw)) {
      // notifications/initialized и подобные: подтверждения не требуют.
      this.#log(`уведомление ${raw.method} — подтверждения не требуется`);
      return null;
    }

    return jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, 'Сообщение не является запросом JSON-RPC 2.0.');
  }

  /**
   * Обрабатывает строку транспорта (одна строка = одно сообщение).
   * Некорректный JSON → PARSE_ERROR с id = null.
   */
  async handleLine(line: string): Promise<JsonRpcResponse | null> {
    const trimmed = line.trim();
    if (trimmed === '') {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = decodeMessage(trimmed);
    } catch {
      return jsonRpcError(null, JSON_RPC_ERROR.PARSE_ERROR, 'Не удалось разобрать JSON сообщения.');
    }
    return this.handle(parsed);
  }

  async #handleRequest(request: {
    id: JsonRpcId;
    method: string;
    params?: unknown;
  }): Promise<JsonRpcResponse> {
    try {
      const result = await this.#dispatch(request.method, request.params);
      return jsonRpcResult(request.id, result);
    } catch (error) {
      const mcpError = toMcpError(error);
      // Неожиданные сбои (не ошибки ядра и не наши) подробно — в stderr,
      // клиенту — только обезличенный текст.
      if (!(error instanceof McpError)) {
        this.#log(`необработанная ошибка метода ${request.method}: ${String(error)}`);
      }
      return jsonRpcError(request.id, mcpError.code, mcpError.message, errorData(mcpError));
    }
  }

  async #dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.#initialize(params);
      case 'ping':
        return {};
      case 'tools/list':
        return this.#toolsList();
      case 'tools/call':
        return this.#toolsCall(params);
      default:
        throw new McpError(JSON_RPC_ERROR.METHOD_NOT_FOUND, `Метод «${method}» не поддерживается.`);
    }
  }

  /**
   * initialize: принимает токен клиента (params.sessionToken) и
   * проверяет сессию. Без валидной сессии рукопожатие не проходит —
   * сервер с самого начала работает только от имени сотрудника.
   */
  async #initialize(params: unknown): Promise<unknown> {
    this.#sessions.adoptFromInitialize(params);
    const session = await this.#sessions.requireSession();

    this.#log(
      `initialize: ${this.#sessions.source === 'none' ? 'токен не передан' : `токен из ${this.#sessions.source}`}, ` +
        `пользователь ${session.user.login}, роль ${session.user.role}`,
    );

    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION, title: 'Деканат УдГУ (MCP)' },
      instructions: SERVER_INSTRUCTIONS,
    };
  }

  /** tools/list: набор инструментов сотрудника деканата. */
  async #toolsList(): Promise<unknown> {
    // Сессия нужна и здесь: без неё сервер не должен рассказывать,
    // какие операции он умеет.
    await this.#sessions.requireSession();
    return {
      tools: DEANERY_TOOLS.map((item) => ({
        name: item.name,
        title: item.title,
        description: item.description,
        inputSchema: inputSchemaOf(item.schema),
      })),
    };
  }

  /** tools/call: аргументы → zod → сервис кабинета → данные. */
  async #toolsCall(params: unknown): Promise<ToolCallResult> {
    const session = await this.#sessions.requireSession();

    if (typeof params !== 'object' || params === null) {
      throw new McpError(JSON_RPC_ERROR.INVALID_PARAMS, 'Параметры вызова инструмента не переданы.');
    }
    const { name, arguments: args } = params as { name?: unknown; arguments?: unknown };
    if (typeof name !== 'string' || name === '') {
      throw new McpError(JSON_RPC_ERROR.INVALID_PARAMS, 'Не указано имя инструмента (name).');
    }

    const tool = findDeaneryTool(name);
    if (tool === undefined) {
      throw new McpError(JSON_RPC_ERROR.TOOL_UNKNOWN, `Инструмент «${name}» не найден.`);
    }

    // Аргументы: объект или ничего. zod-схема инструмента проверяет
    // форму, поэтому отказ по аргументам — стандартный INVALID_PARAMS
    // с человеческим текстом от схемы.
    const parsed = tool.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'аргументы'}: ${issue.message}`);
      throw new McpError(JSON_RPC_ERROR.INVALID_PARAMS, 'Некорректные аргументы инструмента.', {
        details: issues,
      });
    }

    const data = await tool.handler(session, parsed.data as Record<string, unknown>);
    this.#log(`tools/call ${name}: готово (пользователь ${session.user.login})`);
    return toToolCallResult(data);
  }
}

/** Данные ошибки для клиента: машинный код ядра + уточнения. */
function errorData(error: McpError): unknown {
  if (error.coreCode === undefined && error.details === undefined) {
    return undefined;
  }
  const data: Record<string, unknown> = {};
  if (error.coreCode !== undefined) {
    data.code = error.coreCode;
  }
  if (error.details !== undefined) {
    data.details = error.details;
  }
  return data;
}

/**
 * Упаковка результата инструмента: структурированные данные + тот же
 * JSON текстом (MCP-совместимый ответ). Даты сериализуются в ISO.
 */
function toToolCallResult(data: unknown): ToolCallResult {
  return {
    content: [{ type: 'text', text: stringifyJson(data, 2) }],
    structuredContent: data,
  };
}

/**
 * Поднимает сервер на stdio: читает строки stdin, пишет ответы в stdout.
 *
 * Транспорт — newline-delimited JSON (стандарт MCP для stdio): одно
 * сообщение в строке. Конец stdin завершает работу.
 */
export async function serveOverStdio(options: DeaneryServerOptions): Promise<void> {
  const server = new DeaneryMcpServer(options);
  const log = options.log ?? (() => undefined);
  const { createInterface } = await import('node:readline');

  const readline = createInterface({ input: process.stdin, terminal: false });

  for await (const line of readline) {
    const response = await server.handleLine(line);
    if (response !== null) {
      process.stdout.write(encodeMessage(response));
    }
  }

  log('stdin закрыт — сервер завершает работу');
}

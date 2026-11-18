/**
 * JSON-RPC 2.0 для MCP-поверх stdio (BRIEF v2 §7, «MCP-сервер для
 * агентов деканата»).
 *
 * ПОЧЕМУ СВОЙ КОД, А НЕ SDK: воркспейс намеренно остаётся без новых
 * зависимостей (правило задачи: кроме typescript/tsx/zod ничего не
 * добавляем). Транспорт MCP over stdio — это newline-delimited JSON:
 * одно сообщение JSON-RPC в строке, ответ — в строке. Этого достаточно
 * для методов initialize / tools/list / tools/call / ping, которые
 * нужны агенту деканата, и формат проверяется тестом
 * packages/mcp/test/protocol.test.ts на живом дочернем процессе.
 *
 * ГЛАВНОЕ ПРАВИЛО ТРАНСПОРТА: stdout — канал протокола и ТОЛЬКО его.
 * Любые диагностические сообщения сервер пишет в stderr (logError),
 * иначе клиент сломал бы разбор ответов.
 */

/** Версия протокола MCP, которую реализует сервер. */
export const PROTOCOL_VERSION = '2024-11-05';

/** Имя и версия сервера для initialize (serverInfo). */
export const SERVER_NAME = 'udgu-deanery-mcp';
export const SERVER_VERSION = '0.1.0';

/** Инструкция агенту: что это за сервер и с какими данными он работает. */
export const SERVER_INSTRUCTIONS =
  'MCP-сервер кабинета сотрудника деканата УдГУ (учебный прототип, данные синтетические). ' +
  'Инструменты deanery_* работают от сессии сотрудника деканата или администратора: ' +
  'сотрудник видит только свой институт, администратор — все. ' +
  'Каждый инструмент возвращает те же данные, что и соответствующий раздел кабинета.';

/** Идентификатор запроса JSON-RPC (строка или число). */
export type JsonRpcId = string | number;

/** Запрос: метод + параметры + идентификатор (ожидается ответ). */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

/** Уведомление: метод без идентификатора (ответ не отсылается). */
export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

/** Ошибка JSON-RPC: код + текст ДЛЯ ЧЕЛОВЕКА (+ машиные данные). */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** Ответ: либо result, либо error (никогда не оба). */
export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId | null;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

/**
 * Коды ошибок.
 *
 * Стандартные (-32700…-32603) — из спецификации JSON-RPC 2.0. Серверные
 * (-32000…-32099 зарезервированы под реализацию) разделены по причинам,
 * чтобы агент мог отличить «войди» от «нельзя» и «состояние изменилось»:
 *   SESSION_REQUIRED — токен сессии не передан вовсе;
 *   SESSION_INVALID  — токен передан, но сессия невалидна/истекла;
 *   FORBIDDEN        — роль или владение данными не позволяют операцию
 *                      (StaffScope: чужой институт, студент, преподаватель);
 *   CONFLICT         — операция нарушает бизнес-правило (заявка закрыта);
 *   NOT_FOUND        — запрошенной сущности нет (в своём скоупе);
 *   TOOL_UNKNOWN     — инструмента с таким именем нет.
 */
export const JSON_RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SESSION_REQUIRED: -32001,
  SESSION_INVALID: -32002,
  FORBIDDEN: -32003,
  CONFLICT: -32004,
  NOT_FOUND: -32005,
  TOOL_UNKNOWN: -32006,
} as const;

export type JsonRpcErrorCode = (typeof JSON_RPC_ERROR)[keyof typeof JSON_RPC_ERROR];

/** Запрос ли сообщение (есть строковый метод и непустой id). */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || message.method === '') {
    return false;
  }
  const id = message.id;
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

/** Уведомление ли сообщение (метод без id — ответ не нужен). */
export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    message.jsonrpc === '2.0' &&
    typeof message.method === 'string' &&
    message.method !== '' &&
    message.id === undefined
  );
}

/** Успешный ответ. */
export function jsonRpcResult(id: JsonRpcId | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** Ответ-ошибка. Текст message — для человека, data — машиные детали. */
export function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * JSON-сериализация с контрактом «все даты наружу — ISO».
 *
 * Отдельная функция (а не инлайн JSON.stringify), потому что её используют
 * и транспорт, и упаковка результата инструмента: формат дат не должен
 * зависеть от того, кто сериализует.
 */
export function stringifyJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, jsonReplacer, indent);
}

/**
 * Кодирует сообщение в строку транспорта: JSON + перевод строки.
 */
export function encodeMessage(message: unknown): string {
  return `${stringifyJson(message)}\n`;
}

/**
 * Разбирает строку транспорта. Бросает SyntaxError — вызывающий код
 * превращает его в PARSE_ERROR (-32700) с id = null.
 */
export function decodeMessage(line: string): unknown {
  return JSON.parse(line);
}

/**
 * Replier сериализации: даты отдаём ISO-строкой. Иначе JSON.stringify
 * превратил бы Date в «2026-11-18T00:00:00.000Z» сам, но явный replacer
 * документирует контракт «все даты наружу — ISO» и переживает смену
 * источника данных.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Описание наличия токена для логов — БЕЗ значения.
 *
 * Токен сессии равносилен паролю: он не должен попасть ни в stdout
 * (канал протокола), ни в stderr (логи), ни в сообщение об ошибке.
 * Поэтому в диагностиках печатается только факт его наличия.
 */
export function describeTokenPresence(token: string | null): string {
  if (token === null || token.trim() === '') {
    return 'токен не передан';
  }
  return 'токен передан';
}

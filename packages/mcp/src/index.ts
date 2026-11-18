/**
 * Публичный API пакета @udgu/mcp — MCP-сервер для агентов деканата
 * (BRIEF v2 §7).
 *
 * Границы пакета:
 * - protocol — JSON-RPC 2.0 поверх stdio (свой код, без SDK);
 * - session   — авторизация существующим токеном сессии кабинета
 *               (MCP_SESSION_TOKEN или params.sessionToken в initialize);
 * - tools     — инструменты deanery_*: zod-схема + вызов сервиса кабинета;
 * - server    — диспетчер методов initialize/tools/list/tools/call/ping.
 *
 * Пакет НЕ содержит бизнес-логики и правил доступа: всё, что касается
 * прав и владения данными, живёт в packages/core и проверяется на каждом
 * вызове сервиса. Пакет не знает про Next.js и HTTP.
 */
export {
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  SERVER_INSTRUCTIONS,
  JSON_RPC_ERROR,
  describeTokenPresence,
  encodeMessage,
  decodeMessage,
  isJsonRpcRequest,
  isJsonRpcNotification,
  jsonRpcResult,
  jsonRpcError,
  stringifyJson,
} from './protocol';
export type {
  JsonRpcError,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './protocol';

export { SessionContext, SESSION_TOKEN_ENV, SESSION_TOKEN_PARAM } from './session';
export type { TokenSource } from './session';

export { McpError, toMcpError, sessionRequiredError, sessionInvalidError } from './errors';

export { DEANERY_TOOLS, findDeaneryTool, inputSchemaOf } from './tools';
export type { DeaneryTool } from './tools';

export { DeaneryMcpServer, serveOverStdio } from './server';
export type { DeaneryServerOptions, ServerLog } from './server';

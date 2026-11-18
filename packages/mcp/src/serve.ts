/**
 * Вход MCP-сервера: `npm run mcp:serve` в packages/mcp.
 *
 * Запуск:
 *   MCP_SESSION_TOKEN=<токен сессии staff1> npm run mcp:serve
 *
 * Токен сессии сотрудника получается обычным входом в кабинет (как у
 * жюри): POST /api/auth/login → cookie udgu_session. Значение cookie —
 * и есть токен; он равносилен паролю, поэтому:
 *   - в код и в compose он не попадает, только через env;
 *   - в логи не пишется никогда (см. src/session.ts);
 *   - сервер валидирует его боевым validateSession из packages/core.
 *
 * Stdout — канал протокола (JSON-RPC), поэтому все диагностические
 * сообщения уходят в stderr.
 */
import { serveOverStdio } from './server';
import { SessionContext } from './session';
import { describeTokenPresence } from './protocol';

const log = (message: string): void => {
  process.stderr.write(`[udgu-mcp] ${message}\n`);
};

const sessions = new SessionContext();


log(
  `MCP-сервер деканата УдГУ: stdio, ${describeTokenPresence(
    process.env.MCP_SESSION_TOKEN ?? null,
  )} (источник: ${sessions.source})`,
);

await serveOverStdio({ sessions, log });

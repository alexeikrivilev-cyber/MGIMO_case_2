/**
 * Вход MCP-сервера деканата: выбор транспорта.
 *
 *   --transport stdio | http   (аргумент)
 *   MCP_TRANSPORT=stdio|http   (переменная окружения)
 *   по умолчанию — stdio (так агент деканата поднимает сервер чаще
 *   всего: дочерним процессом своей сессии).
 *
 * Запуск:
 *   MCP_SESSION_TOKEN=<токен сессии staff1> npm run mcp:serve
 *   npm run mcp:serve:http     # HTTP на 127.0.0.1:8787
 *
 * Токен сессии сотрудника получается обычным входом в кабинет (как у
 * жюри): POST /api/auth/login → cookie udgu_session. Значение cookie —
 * и есть токен; он равносилен паролю, поэтому:
 *   - в код и в compose он не попадает, только через env;
 *   - в логи не пишется никогда (см. session.ts);
 *   - сервер валидирует его боевым validateSession из packages/core.
 *
 * ДИАГНОСТИКА — только stderr, и в ней НИКОГДА не печатаются токен и
 * DATABASE_URL.
 */
import { ensureDatabaseUrlFromRootEnv } from './env.js';
import { serveOverHttp } from './http.js';
import type { ServerLog } from './server.js';

/** Диагностика в stderr. */
const log: ServerLog = (message) => {
  process.stderr.write(`[udgu-mcp] ${message}\n`);
};

type Transport = 'stdio' | 'http';

/** Транспорт из аргумента --transport (приоритетнее env). */
function transportFromArgv(argv: readonly string[]): Transport | null {
  const index = argv.indexOf('--transport');
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (value === 'stdio' || value === 'http') {
    return value;
  }
  return null;
}

/** Транспорт из env MCP_TRANSPORT. */
function transportFromEnv(env: Record<string, string | undefined>): Transport | null {
  const value = env.MCP_TRANSPORT?.trim().toLowerCase();
  if (value === 'stdio' || value === 'http') {
    return value;
  }
  return null;
}

const transport = transportFromArgv(process.argv.slice(2)) ?? transportFromEnv(process.env) ?? 'stdio';

if (transport === 'stdio') {
  // Дефект волны A: дочерний процесс без окружения падал
  // «DATABASE_URL не задан» — корневой .env подхватывается здесь (и в
  // самой точке входа stdio, если её запускают напрямую). Путь к .env —
  // от расположения кода, не от рабочего каталога.
  ensureDatabaseUrlFromRootEnv();
  const { serveOverStdio } = await import('./stdio.js');
  await serveOverStdio();
} else {
  log('выбран транспорт http');
  await serveOverHttp();
}

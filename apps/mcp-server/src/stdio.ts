/**
 * Stdio-транспорт MCP-сервера: официальный StdioServerTransport.
 *
 * Запуск (как отдельный процесс — так его поднимает агент деканата):
 *   MCP_SESSION_TOKEN=<токен сессии staff1> node --import tsx src/stdio.ts
 *
 * КОРНЕВОЙ .env подхватывается, ЕСЛИ DATABASE_URL не задан (дефект
 * волны A: дочерний процесс без окружения падал «DATABASE_URL не
 * задан»). Путь к .env — от расположения кода, не от рабочего
 * каталога (см. env.ts).
 *
 * ТОКЕН СЕССИИ — из env MCP_SESSION_TOKEN; resolveToken читает
 * окружение на каждый вызов. Токен равносилен паролю: в диагностиках
 * (stderr) печатается только факт наличия.
 *
 * stdout — канал протокола и ТОЛЬКО он: все диагностические сообщения
 * уходят в stderr, иначе клиент сломал бы разбор ответов.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDeaneryServer, type ServerLog } from './server.js';
import { describeTokenPresence, tokenFromEnv } from './session.js';
import { ensureDatabaseUrlFromRootEnv } from './env.js';

/** Диагностика в stderr: stdout занят протоколом. */
const log: ServerLog = (message) => {
  process.stderr.write(`[udgu-mcp] ${message}\n`);
};

/**
 * Поднимает сервер на stdio и завершает процесс по закрытию stdin.
 *
 * SDK-транспорт сам не выходит по «концу stdin» (у агента это
 * выглядело бы как повисший дочерний процесс), поэтому закрытие
 * потока завершает сервер явно.
 */
export async function serveOverStdio(): Promise<void> {
  // Дефект волны A: дочерний процесс без окружения не видел .env.
  ensureDatabaseUrlFromRootEnv();

  const server = createDeaneryServer({
    resolveToken: () => tokenFromEnv(),
    log,
  });

  const transport = new StdioServerTransport();
  transport.onerror = (error) => {
    log(`транспорт stdio: ${error.message}`);
  };
  transport.onclose = () => {
    log('транспорт stdio закрыт');
  };

  await server.connect(transport);

  log(
    `MCP-сервер деканата УдГУ: stdio, ${describeTokenPresence(tokenFromEnv())} (источник: env MCP_SESSION_TOKEN)`,
  );

  let shuttingDown = false;
  const shutdown = (reason: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(reason);
    void server.close().then(
      () => process.exit(0),
      () => process.exit(0),
    );
  };

  process.stdin.on('end', () => shutdown('stdin закрыт — сервер завершает работу'));
  process.stdin.on('close', () => shutdown('stdin закрыт — сервер завершает работу'));
  process.on('SIGINT', () => shutdown('получен SIGINT — сервер завершает работу'));
  process.on('SIGTERM', () => shutdown('получен SIGTERM — сервер завершает работу'));
}

/** Файл запущен напрямую (node --import tsx src/stdio.ts) — слушаем stdio. */
function isEntry(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntry(import.meta.url)) {
  await serveOverStdio();
}

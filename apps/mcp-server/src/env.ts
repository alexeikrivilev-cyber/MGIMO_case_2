/**
 * Загрузка корневого .env монорепо для процессов MCP-сервера.
 *
 * ЗАЧЕМ (дефект волны A): MCP-сервер поднимается ДОЧЕРНИМ процессом
 * (агент деканата спавнит `mcp:serve`), а дочерний процесс не получает
 * окружение shells-окружения разработчика. В волне A сервер падал с
 * «DATABASE_URL не задан», потому что .env читал только Next.js.
 *
 * ПУТЬ — от расположения кода (как storageRoot в packages/core), а не
 * от рабочего каталога процесса: агент может запустить сервер из
 * любого каталога, .env всё равно должен находиться.
 *
 * process.loadEnvFile НЕ перезаписывает уже заданные переменные
 * окружения, поэтому загрузка безопасна: явный env процесса главнее.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Корень монорепы: apps/mcp-server/src/env.ts → корень. */
export function monorepoRoot(): string {
  return resolve(moduleDir, '../../..');
}

/** Путь к корневому .env монорепо. */
export function rootEnvPath(): string {
  return resolve(monorepoRoot(), '.env');
}

/** Задана ли переменная окружения (пустая строка считается незаданной). */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

/**
 * Загружает корневой .env, ЕСЛИ DATABASE_URL не задан.
 *
 * Провка перед загрузкой — не обязательная (loadEnvFile и так не
 * перезаписывает), но она документирует намерение: файл читается
 * ради строки подключения, а не «на всякий случай». Отсутствие .env —
 * не ошибка: переменные могут прийти из окружения (тесты, прод).
 */
export function ensureDatabaseUrlFromRootEnv(): void {
  if (isSet(process.env.DATABASE_URL)) {
    return;
  }
  try {
    process.loadEnvFile(rootEnvPath());
  } catch {
    // .env нет или не читается — переменные должны прийти из окружения.
  }
}

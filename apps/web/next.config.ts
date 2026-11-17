import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Поднимает переменные из корневого .env (DATABASE_URL и др.) в процесс
 * Next: приложение запускается из apps/web, а .env лежит в корне
 * монорепы — Next сам его не читает. Тот же приём используют сидер и
 * тесты packages/core.
 *
 * NODE_ENV намеренно НЕ трогаем: режим (development/production) задаёт
 * сам Next, а значение из .env предназначено инструментам вроде сидера.
 * process.loadEnvFile не перезаписывает уже заданные переменные —
 * переменные окружения процесса (docker-compose, systemd) главнее.
 */
function loadRootEnv(): void {
  const envPath = path.resolve(configDir, '../../.env');
  if (!existsSync(envPath)) {
    return;
  }
  const hadNodeEnv = process.env.NODE_ENV !== undefined;
  try {
    process.loadEnvFile(envPath);
  } catch {
    return;
  }
  if (!hadNodeEnv) {
    // process.env типизирован как read-only; реально свойство удаляемое.
    const env = process.env as Record<string, string | undefined>;
    delete env.NODE_ENV;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ['@udgu/ui', '@udgu/core', '@udgu/db'],
  // argon2 — нативный модуль (node-gyp): Next не должен бандлить его,
  // нужен require из node_modules в рантайме Node.js.
  serverExternalPackages: ['argon2'],
  output: 'standalone',
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Service-Worker-Allowed: / — без него браузер ограничивает scope
        // service worker каталогом файла (/), и оболочка не перехватывала
        // бы навигацию по всему кабинету.
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          // Обновления воркера должны доходить до клиента сразу:
          // закешированный sw.js иначе живёт в браузере часами.
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;

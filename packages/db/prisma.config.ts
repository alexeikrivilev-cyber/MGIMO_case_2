import { defineConfig } from 'prisma/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Prisma 7: prisma.config.ts — единая точка конфигурации CLI.
// datasource.url больше не задаётся в schema.prisma.

const configDir = path.dirname(fileURLToPath(import.meta.url));

function loadRootEnv(): void {
  // CLI Prisma подхватывает .env сам, но seed.ts запускается как обычный
  // node-процесс — поэтому гарантируем наличие DATABASE_URL явно.
  const envPath = path.resolve(configDir, '../../.env');
  try {
    process.loadEnvFile(envPath);
  } catch {
    // .env отсутствует (например, в CI) — переменные должны прийти из окружения.
  }
}

loadRootEnv();

const datasourceUrl = process.env.DATABASE_URL;

// Prisma 7.10: конфиг CLI не поддерживает ключ adapter — migrate/deploy
// подключаются к базе напрямую через datasource.url. Драйверный адаптер
// PrismaPg используется рантайм-клиентом (src/client.ts).
export default defineConfig({
  schema: path.join(configDir, 'prisma/schema.prisma'),
  migrations: {
    path: path.join(configDir, 'prisma/migrations'),
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    url: datasourceUrl,
  },
});

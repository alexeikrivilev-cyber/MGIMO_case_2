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
if (!datasourceUrl) {
  throw new Error(
    'DATABASE_URL не задан. Скопируй .env.example в .env или экспортируй переменную окружения.',
  );
}

export default defineConfig({
  schema: path.join(configDir, 'prisma/schema.prisma'),
  migrations: {
    path: path.join(configDir, 'prisma/migrations'),
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    url: datasourceUrl,
  },
  adapter: async () => {
    const { PrismaPg } = await import('@prisma/adapter-pg');
    return new PrismaPg({ connectionString: datasourceUrl });
  },
});

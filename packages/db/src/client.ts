import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

/**
 * Синглтон PrismaClient с адаптером PrismaPg (Prisma 7, драйверные адаптеры).
 *
 * Клиент создаётся лениво: импорт пакета не требует DATABASE_URL, поэтому
 * `next build` и бандлинг в Docker работают без переменных окружения.
 * В dev-режиме клиент кешируется на globalThis, чтобы горячая перезагрузка
 * не открывала новые подключения к PostgreSQL.
 */
const globalForPrisma = globalThis as unknown as { horizonPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL не задан. Скопируй .env.example в .env или экспортируй переменную окружения.',
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  globalForPrisma.horizonPrisma ??= createClient();
  return globalForPrisma.horizonPrisma;
}

export * from './generated/client';

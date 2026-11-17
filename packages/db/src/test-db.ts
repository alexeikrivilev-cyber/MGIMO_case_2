/**
 * Подготовка тестовой базы для `npm test`.
 *
 * ЗАЧЕМ: раньше тесты требовали ручной подготовки (`CREATE DATABASE
 * horizon_test` + `prisma migrate deploy` против неё) — на чистом клоне
 * `npm test` падал с PrismaClientKnownRequestError, потому что в тестовой
 * базе не было последних миграций. Это ломалло критерий приёмки PO
 * («npm install → миграции → сидер → build проходят на чистом клоне»).
 *
 * Теперь подготовка идемпотентентная и автоматическая: создать базу, если
 * её нет, и применить все миграции из prisma/migrations. Прод-база
 * (horizon) тестами не трогается — работаем только с тестовой.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Корень packages/db (из src/ — на уровень выше). */
const dbPackageDir = path.resolve(moduleDir, '..');

/**
 * Вытаскивает из URL подключения компоненты, needed чтобы создать базу:
 * PostgreSQL не позволяет `CREATE DATABASE`, находясь внутри неё.
 */
function parseConnection(url: string): {
  adminUrl: string;
  database: string;
} {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (database === '') {
    throw new Error(`Не удалось разобрать имя базы из URL: ${url}`);
  }
  // Подключаемся к служебной базе postgres — она есть в любом кластере.
  const admin = new URL(url);
  admin.pathname = '/postgres';
  return { adminUrl: admin.toString(), database };
}

/** Создаёт базу, если она ещё не существует (ошибка «уже есть» — не ошибка). */
async function createDatabaseIfMissing(adminUrl: string, database: string): Promise<void> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Сначала проверяем: между проверкой и созданием другой процесс может
    // успеть создать ту же базу, поэтому оба кода ошибки считаем нормой.
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (existing.rowCount !== 0 && existing.rowCount !== null) {
      return;
    }
    await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 42P04 — duplicate_database; 23505 — unique_violation на
    // pg_database_datname_index (гонка двух CREATE DATABASE). Оба значат
    // «база уже есть», что для идемпотентной подготовки — успех.
    if (code !== '42P04' && code !== '23505') {
      throw error;
    }
  } finally {
    await client.end();
  }
}

/**
 * Готовит тестовую базу: создаёт (если нужно) и применяет миграции.
 * Безопасно вызывать много раз — `migrate deploy` идемпотентен.
 */
export async function ensureTestDatabase(testDatabaseUrl: string): Promise<void> {
  const { adminUrl, database } = parseConnection(testDatabaseUrl);
  await createDatabaseIfMissing(adminUrl, database);

  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', path.join(dbPackageDir, 'prisma/schema.prisma')],
    {
      cwd: dbPackageDir,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: 'pipe',
    },
  );
}

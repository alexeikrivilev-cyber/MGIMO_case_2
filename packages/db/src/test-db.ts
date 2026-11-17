/**
 * Подготовка тестовой базы для `npm test`.
 *
 * ЗАЧЕМ (две независимые причины, обе ломали приёмку):
 *
 * 1. Ручная подготовка. Раньше тесты требовали `CREATE DATABASE horizon_test`
 *    + `prisma migrate deploy` против неё, и на чистом клоне `npm test` падал
 *    с PrismaClientKnownRequestError — критерий PO «npm install → миграции →
 *    сидер → build проходят на чистом клоне» не выполнялся.
 *
 * 2. Гонка за одну базу. Тесты делают `deleteMany()` по всем таблицам
 *    (resetTestData), поэтому два одновременных `npm test` на общей
 *    `horizon_test` взаимно сносят данные: нарушения FK, нестабильное число
 *    тестов, ложно-красные QA-гейты у обоих прогонов. Воспроизводилось на
 *    практике: воркер и тимлид гоняли `npm test` одновременно.
 *
 * Решение: каждый процесс тестов получает СВОЮ базу
 * `<base>_<pid>_<timestamp>`, создаёт и мигрирует её сам. Параллельные
 * прогоны больше не пересекаются. Прод-база (horizon) не трогается никогда.
 *
 * Орфаны (процесс убили) подчищаются на старте следующего прогона: база
 * считается мёртвой, если её PID уже не существует.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Корень packages/db (из src/ — на уровень выше). */
const dbPackageDir = path.resolve(moduleDir, '..');

/** Префикс имён изолированных тестовых баз. */
const TEST_DB_PREFIX = 'horizon_test_';

/**
 * Разбирает URL подключения: PostgreSQL не позволяет `CREATE DATABASE`,
 * находясь внутри неё, поэтому админ-подключение идёт к базе `postgres`.
 */
function parseConnection(url: string): { adminUrl: string; database: string } {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (database === '') {
    throw new Error(`Не удалось разобрать имя базы из URL: ${url}`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  return { adminUrl: admin.toString(), database };
}

/** URL той же строкой подключения, но к другой базе. */
function urlForDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

/** Жив ли процесс с таким PID (сигнал 0 — проверка без воздействия). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM — процесс есть, но чужой: считаем живым.
    return (error as { code?: string }).code === 'EPERM';
  }
}

async function withAdminClient<T>(
  adminUrl: string,
  fn: (client: import('pg').Client) => Promise<T>,
): Promise<T> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Удаляет изолированные тестовые базы, чей PID уже мёртв. Самоисцеление:
 * убитый прогон не оставляет мусор навсегда, а отдельный сборщик не нужен.
 */
async function dropOrphanedDatabases(adminUrl: string): Promise<void> {
  const alive = await withAdminClient(adminUrl, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${TEST_DB_PREFIX}%`],
    );
    return rows.map((row) => row.datname);
  });

  for (const datname of alive) {
    // Имя вида horizon_test_<pid>_<ts> — вытаскиваем PID.
    const pid = Number.parseInt(datname.slice(TEST_DB_PREFIX.length), 10);
    if (Number.isNaN(pid) || isProcessAlive(pid)) {
      continue;
    }
    await withAdminClient(adminUrl, async (client) => {
      // TERMINATE — иначе DROP висит на открытых коннектах убитого прогона.
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [datname],
      );
      await client.query(`DROP DATABASE IF EXISTS "${datname.replace(/"/g, '""')}"`);
    });
  }
}

/** Применяет миграции Prisma к указанной базе. */
function migrateDatabase(databaseUrl: string): void {
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', path.join(dbPackageDir, 'prisma/schema.prisma')],
    {
      cwd: dbPackageDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );
}

/**
 * Создаёт изолированную тестовую базу для текущего процесса, применяет
 * миграции и возвращает URL к ней.
 *
 * Возвращает URL, а не мутирует окружение: вызывающий сам решает, когда
 * переключить `process.env.DATABASE_URL` (до первого обращения к Prisma).
 * Идемпотентно в пределах одного имени — повторный вызов безопасен.
 */
export async function ensureTestDatabase(baseTestDatabaseUrl: string): Promise<string> {
  const { adminUrl, database } = parseConnection(baseTestDatabaseUrl);

  await dropOrphanedDatabases(adminUrl);

  const isolated = `${TEST_DB_PREFIX}${process.pid}_${Date.now().toString(36)}`;
  const isolatedUrl = urlForDatabase(baseTestDatabaseUrl, isolated);

  await withAdminClient(adminUrl, async (client) => {
    // Сначала проверяем: между проверкой и созданием другой процесс может
    // успеть создать ту же базу, поэтому оба кода ошибки считаем нормой.
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [isolated],
    );
    if (existing.rowCount === 0 || existing.rowCount === null) {
      await client.query(`CREATE DATABASE "${isolated.replace(/"/g, '""')}"`);
    }
  });

  migrateDatabase(isolatedUrl);

  // Базовая тестовая база остаётся как есть — её могли готовить вручную.
  void database;
  return isolatedUrl;
}

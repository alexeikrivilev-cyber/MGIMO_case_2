/**
 * ИНТЕГРАЦИОННАЯ ПРОВЕРКА СИДЕРА: учебный план преподавателя попадает
 * и в базу, и в ПРИВАТНОЕ хранилище (storage/study-plans/<teacherId>/).
 *
 * Зачем отдельный файл: seed.test.ts проверяет buildSeedData() как ЧИСТУЮ
 * генерацию (без БД), а здесь проверяется сама запись — сидер запускается
 * настоящим процессом (ровно тем же способом, что и prisma db seed)
 * против изолированной тестовой базы и временного хранилища:
 * - строка StudyPlan создана (title, fileName, mime text/markdown,
 *   sizeBytes, storagePath — путь относительно корня хранилища);
 * - файл плана существует в хранилище после сидера и содержит его текст;
 * - повторный сидер идемпотентен: в хранилище один файл плана, мусор
 *   прошлых запусков подчищен.
 *
 * Прод-база horizon и storage/ репозитория тестами не трогаются:
 * база изолированная на процесс (src/test-db.ts), хранилище — временный
 * каталог ОС.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { buildSeedData } from '../src/seed-data.js';
import { ensureTestDatabase } from '../src/test-db.js';
import { getPrisma } from '../src/client.js';

const dbPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Читает корневой .env (process.loadEnvFile — Node 20.12+). */
function loadRootEnv(): void {
  try {
    process.loadEnvFile(path.resolve(dbPackageDir, '../../.env'));
  } catch {
    // .env отсутствует — переменные должны прийти из окружения.
  }
}

loadRootEnv();

// Приватное хранилище сидера — во временный каталог этого прогона.
const storageDir = mkdtempSync(path.join(os.tmpdir(), 'udgu-seed-storage-'));

test.before(async () => {
  const baseUrl =
    process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/horizon_test?schema=public';
  // Изолированная база процесса + миграции: прод-база не трогается.
  // Переключаем ДО первого обращения к Prisma — клиент читает URL лениво.
  process.env.DATABASE_URL = await ensureTestDatabase(baseUrl);
});

test.after(async () => {
  await getPrisma().$disconnect();
  rmSync(storageDir, { recursive: true, force: true });
});

/** Запускает сидер настоящим процессом — как это делает prisma db seed. */
function runSeeder(): void {
  execFileSync('node', ['--import', 'tsx', 'prisma/seed.ts'], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, STORAGE_DIR: storageDir },
    stdio: 'pipe',
  });
}

test('сидер пишет учебный план в базу, а файл — в приватное хранилище', async () => {
  runSeeder();

  const expected = (await buildSeedData()).studyPlans[0];
  assert.ok(expected, 'buildSeedData создаёт демо-план');

  const plan = await getPrisma().studyPlan.findFirst({
    where: { teacher: { user: { login: 'teacher1' } } },
    select: {
      title: true,
      fileName: true,
      mime: true,
      sizeBytes: true,
      storagePath: true,
      teacher: { select: { user: { select: { login: true } } } },
    },
  });
  assert.ok(plan, 'строка StudyPlan создана сидером');
  assert.equal(plan.teacher.user.login, 'teacher1', 'план принадлежит преподавателю');
  assert.equal(plan.title, expected.title);
  assert.equal(plan.fileName, expected.fileName);
  assert.equal(plan.mime, 'text/markdown');
  assert.equal(plan.sizeBytes, Buffer.byteLength(expected.text, 'utf8'), 'размер — байты текста плана');
  assert.match(
    plan.storagePath,
    /^study-plans\/[0-9a-f-]+\/[0-9a-f-]{36}\.md$/,
    'storagePath — относительный путь внутри хранилища',
  );

  // Файл плана существует в хранилище после сидера и содержит его текст.
  const absolutePath = path.join(storageDir, plan.storagePath);
  assert.ok(existsSync(absolutePath), 'файл плана существует в хранилище');
  assert.equal(statSync(absolutePath).size, plan.sizeBytes, 'размер файла совпадает с записью в БД');
  assert.equal(readFileSync(absolutePath, 'utf8'), expected.text, 'содержимое файла — текст плана сидера');
});

test('сидер идемпотентен: повторный запуск не оставляет осиротевших файлов планов', async () => {
  runSeeder();

  const studyPlanRoot = path.join(storageDir, 'study-plans');
  const teacherDirs = readdirSync(studyPlanRoot);
  assert.equal(teacherDirs.length, 1, 'в хранилище каталог только одного преподавателя');
  const files = readdirSync(path.join(studyPlanRoot, teacherDirs[0] ?? ''));
  assert.equal(files.length, 1, 'файл плана один: чистка хранилища при сидере работает');

  assert.equal(await getPrisma().studyPlan.count(), 1, 'в базе один план');
});

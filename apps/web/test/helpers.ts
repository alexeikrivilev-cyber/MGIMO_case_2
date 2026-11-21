import { before } from 'node:test';
/**
 * Помощник тестов apps/web (node:test + tsx).
 *
 * Подход: маршруты и middleware импортируются НАПРЯМУЮ и вызываются
 * с настоящими NextRequest — без dev/preview-сервера. Это быстрее
 * сервера, не занимает порт и проверяет ровно тот код, который живёт
 * в продакшне (route handlers + middleware + packages/core), включая
 * гейтинг middleware (401/404/CSRF), который при вызове только
 * обработчика маршрута не проверялся бы вовсе.
 *
 * База — отдельная тестовая horizon_test (как в packages/core):
 * прод-база Horizon тестами не трогается. Файлы гоняются последовательно
 * (--test-concurrency=1), общая база на время файла принадлежит ему.
 *
 * Приватное хранилище фото студбилетов перенаправляется в временный
 * каталог: тесты не пишут в storage/ репозитория.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { getPrisma } from '@udgu/db';
import { hashPassword, resetSessionRateLimit } from '@udgu/core';
import { DEMO_PASSWORD } from '@udgu/ui';
import { ensureTestDatabase } from '@udgu/db';

const webDir = path.dirname(fileURLToPath(import.meta.url));

/** Читает корневой .env (process.loadEnvFile — Node 20.12+). */
function loadRootEnv(): void {
  const envPath = path.resolve(webDir, '../../../.env');
  try {
    process.loadEnvFile(envPath);
  } catch {
    // .env нет — переменные должны прийти из окружения.
  }
}

loadRootEnv();

// Приложение переключаем на тестовую базу ДО первого обращения к сервисам.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/horizon_test?schema=public';

/**
 * Тестовая база готовится САМА (создание + миграции), поэтому `npm test`
 * проходит на чистом клоне без ручных шагов — критерий приёмки PO.
 * Хук корневого уровня: node:test выполняет его один раз перед всеми
 * тестами процесса, поэтому отдельным файлам ничего добавлять не нужно.
 *
 * Здесь же обнуляется in-memory лимитер действий кабинета
 * (resetSessionRateLimit): счётчики живут в процессе, и без сброса
 * лимит одного файла тестов утекал бы в следующие (файлы выполняются
 * последовательно, но в одном процессе — по файлу на процесс).
 */
let testDatabaseUrl: string | null = null;

/**
 * Гарантия «изолированная база создана и мигрирована» с мемоизацией.
 * Вызывается и из корневого хука, и из resetWebTestData — чтобы не зависеть
 * от порядка хуков node:test.
 *
 * Своя база на процесс: параллельный `npm test` иначе сносит чужие данные
 * через deleteMany и даёт ложно-красные прогоны у обоих.
 */
async function ensureTestDatabaseOnce(): Promise<void> {
  if (testDatabaseUrl !== null) {
    return;
  }
  testDatabaseUrl = await ensureTestDatabase(process.env.DATABASE_URL as string);
  process.env.DATABASE_URL = testDatabaseUrl;
}

before(async () => {
  resetSessionRateLimit();
  await ensureTestDatabaseOnce();
});

// Приватное хранилище фото — во временный каталог этого прогона.
const testStorageDir = mkdtempSync(path.join(os.tmpdir(), 'udgu-web-storage-'));
process.env.STORAGE_DIR = testStorageDir;

/**
 * Пароль тестовых аккаунтов — DEMO_PASSWORD из @udgu/ui: сидер и
 * подсказка на форме входа используют то же значение, хардкода нет.
 */
export const TEST_PASSWORD = DEMO_PASSWORD;

/** Очищает все таблицы в порядке, безопасном для FK. */
export async function resetWebTestData(): Promise<void> {
  // Лимитер действий кабинета живёт в памяти процесса: сбрасываем там же,
  // где сбрасываются данные, — иначе счётчик предыдущего файла тестов
  // утекал бы в следующий.
  resetSessionRateLimit();
  await ensureTestDatabaseOnce();
  const prisma = getPrisma();
  await prisma.auditEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.session.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.request.deleteMany();
  await prisma.grade.deleteMany();
  await prisma.scheduleEntry.deleteMany();
  await prisma.studentVerification.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.oAuthIntent.deleteMany();
  await prisma.sickLeave.deleteMany();
  await prisma.officeHour.deleteMany();
  await prisma.identityRegistry.deleteMany();
  // Переписка: сообщения ссылаются на диалог И на автора (User) —
  // чистим до студентов, преподавателей и пользователей.
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  // Учебные планы ссылаются на преподавателя — чистим до студентов.
  await prisma.studyPlan.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.group.deleteMany();
  // FK-страховка: события аудита ссылаются на User — повторяем чистку непосредственно перед пользователями на случай записи, принятой в окно между началом reset и этим местом.
  await prisma.auditEvent.deleteMany();
  await prisma.user.deleteMany();
}

/** Закрывает подключение и убирает временное хранилище (хук after). */
export async function closeWebTestDb(): Promise<void> {
  await getPrisma().$disconnect();
  rmSync(testStorageDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Фикстуры
// ---------------------------------------------------------------------------

export const FACULTY_A = 'Институт математики, информационных технологий и физики';
export const FACULTY_B = 'Институт права, социального управления и безопасности';
export const DIRECTION_A = '09.03.03 Прикладная информатика';
export const DIRECTION_B = '40.03.01 Юриспруденция';

let serial = 0;
function nextSerial(): number {
  serial += 1;
  return serial;
}

export async function createGroup(
  name: string,
  faculty = FACULTY_A,
  course = 3,
  direction = DIRECTION_A,
): Promise<{ id: string; name: string }> {
  return getPrisma().group.create({
    data: { name, faculty, course, direction },
    select: { id: true, name: true },
  });
}

export async function createUser(
  login: string,
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
  password: string = TEST_PASSWORD,
): Promise<{ id: string; login: string }> {
  return getPrisma().user.create({
    data: { login, passwordHash: await hashPassword(password), role },
    select: { id: true, login: true },
  });
}

export async function createStudent(
  login: string,
  groupId: string,
  overrides: {
    lastName?: string;
    firstName?: string;
    faculty?: string;
    direction?: string;
    course?: number;
  } = {},
): Promise<{ userId: string; studentId: string; login: string; studentCardNumber: string }> {
  const user = await createUser(login, 'STUDENT');
  const studentCardNumber = `UDGU-TEST-${String(nextSerial()).padStart(4, '0')}`;
  const student = await getPrisma().student.create({
    data: {
      userId: user.id,
      lastName: overrides.lastName ?? 'Иванов',
      firstName: overrides.firstName ?? 'Александр',
      middleName: 'Дмитриевич',
      faculty: overrides.faculty ?? FACULTY_A,
      direction: overrides.direction ?? DIRECTION_A,
      course: overrides.course ?? 3,
      groupId,
      email: `${login}@udsu.ru`,
      studentCardNumber,
    },
    select: { id: true },
  });
  return { userId: user.id, studentId: student.id, login, studentCardNumber };
}

export async function createVerification(
  studentId: string,
  status: 'PENDING' | 'VERIFIED' | 'REJECTED',
): Promise<void> {
  await getPrisma().studentVerification.create({
    data: {
      studentId,
      status,
      idCardPhotoPath: `id-cards/${studentId}/fixture.jpg`,
      recognizedLastName: 'Иванов',
      recognizedFirstName: 'Александр',
      recognizedGroupName: 'Группа-фикстура',
      recognizedCardNumber: 'UDGU-TEST-0000',
      matchScore: status === 'VERIFIED' ? 1 : null,
    },
  });
}

export async function createTeacher(
  login: string,
  overrides: { lastName?: string; department?: string; position?: string } = {},
): Promise<{ userId: string; teacherId: string }> {
  const user = await createUser(login, 'STAFF');
  const teacher = await getPrisma().teacher.create({
    data: {
      userId: user.id,
      lastName: overrides.lastName ?? 'Преподавательская',
      firstName: 'Ольга',
      middleName: 'Игоревна',
      department: overrides.department ?? 'Кафедра информационных технологий',
      position: overrides.position ?? 'доцент',
    },
    select: { id: true },
  });
  return { userId: user.id, teacherId: teacher.id };
}

export async function createSubject(code: string, name: string): Promise<string> {
  const subject = await getPrisma().subject.create({
    data: { code, name, faculty: FACULTY_A },
    select: { id: true },
  });
  return subject.id;
}

export async function createGrade(
  studentId: string,
  subjectId: string,
  value: number | null,
  passed: boolean | null,
  type: 'EXAM' | 'CREDIT' | 'COURSEWORK',
  semester: number,
): Promise<string> {
  const grade = await getPrisma().grade.create({
    data: {
      studentId,
      subjectId,
      value,
      passed,
      type,
      date: new Date('2026-06-01T00:00:00.000Z'),
      semester,
    },
    select: { id: true },
  });
  return grade.id;
}

export async function createRequest(
  studentId: string,
  status: 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED' = 'NEW',
): Promise<string> {
  const request = await getPrisma().request.create({
    data: {
      studentId,
      type: 'REFERENCE',
      formData: { purpose: 'По месту требования' },
      status,
    },
    select: { id: true },
  });
  return request.id;
}

export async function createNotification(userId: string, title: string): Promise<string> {
  const notification = await getPrisma().notification.create({
    data: { userId, type: 'SYSTEM', title, body: 'Текст уведомления для теста.' },
    select: { id: true },
  });
  return notification.id;
}

export async function createIdentityRegistryEntry(
  cardNumber: string,
  groupId: string,
): Promise<void> {
  await getPrisma().identityRegistry.create({
    data: {
      cardNumber,
      lastName: 'Иванов',
      firstName: 'Александр',
      middleName: 'Дмитриевич',
      groupId,
      faculty: FACULTY_A,
      program: DIRECTION_A,
      course: 3,
      issuedAt: new Date('2024-09-01T00:00:00.000Z'),
    },
  });
}

/** Дата в полночь UTC — как хранит Prisma для @db.Date. */
export function utcDay(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export async function createScheduleEntry(input: {
  groupId: string;
  subjectId: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
}): Promise<string> {
  const entry = await getPrisma().scheduleEntry.create({
    data: {
      groupId: input.groupId,
      subjectId: input.subjectId,
      teacherId: input.teacherId,
      date: utcDay(input.date),
      startTime: input.startTime,
      endTime: input.endTime,
      room: input.room ?? 'У-101',
      type: 'LECTURE',
      status: 'SCHEDULED',
    },
    select: { id: true },
  });
  return entry.id;
}

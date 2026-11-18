/**
 * Фикстуры тестов apps/mcp-server.
 *
 * Тесты MCP гоняют сервер тремя способами — in-memory парой
 * транспортов SDK, живым дочерним процессом (stdio) и живым HTTP —
 * поэтому им нужна своя изолированная база: процесс-сервер
 * подключается к ней по DATABASE_URL из окружения, переданного в spawn.
 * Схема та же, что в packages/mcp/test/fixtures.ts волны A: своя база
 * на процесс (ensureTestDatabase), очистка таблиц между файлами,
 * сидер-фикстуры — вымышленные студенты, сотрудник и заявки.
 *
 * Прод-база (horizon) тестами не трогается никогда: клиент создаётся
 * лениво, а этот модуль переключает DATABASE_URL ДО первого обращения.
 * Исключение — регрессия на дефект волны A (stdio.test.ts): там
 * дочерний процесс намеренно запускается БЕЗ DATABASE_URL и берёт
 * строку подключения из корневого .env; токен при этом заведомо
 * неверный, поэтому запрос только читает сессию и ничего не пишет.
 */
import { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getPrisma, ensureTestDatabase } from '@udgu/db';
import { createSession, hashPassword } from '@udgu/core';

const mcpServerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootEnvPath = path.resolve(mcpServerDir, '../../.env');

/** Читает корневой .env (process.loadEnvFile — Node 20.12+). */
function loadRootEnv(): void {
  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
    // .env нет — переменные должны прийти из окружения.
  }
}

loadRootEnv();

const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/horizon_test?schema=public';

let isolatedUrl: string | null = null;
let storageDir: string | null = null;

/**
 * Гарантия «изолированная база создана и мигрирована».
 *
 * Мемоизируется ПРОМИС, а не результат: корневой хук `before` из этого
 * модуля и `before` тестового файла (который зовёт resetTestData)
 * выполняются одновременно, и два параллельных вызова создали бы ДВЕ
 * базы — родитель писал бы фикстуры в одну, а дочерний процесс сервера
 * подключался бы к другой (пустой). Промис-мемо делает вызов
 * идемпотентным при любом порядке хуков node:test.
 *
 * Переключает DATABASE_URL ДО первого обращения к Prisma.
 */
let ensuring: Promise<string> | null = null;

export function ensureIsolatedDatabase(): Promise<string> {
  if (isolatedUrl !== null) {
    return Promise.resolve(isolatedUrl);
  }
  ensuring ??= (async () => {
    const url = await ensureTestDatabase(TEST_DATABASE_URL);
    // Переключаем ДО первого обращения к Prisma — клиент читает URL лениво.
    process.env.DATABASE_URL = url;
    isolatedUrl = url;
    return url;
  })();
  return ensuring;
}

/** Корень хранилища файлов для процесса-сервера (вне репозитория). */
export async function ensureStorageDir(): Promise<string> {
  if (storageDir !== null) {
    return storageDir;
  }
  storageDir = await mkdtemp(path.join(tmpdir(), 'udgu-mcp-storage-'));
  return storageDir;
}

/** Prisma-клиент теста (тот же ленивый сингтлон, что у ядра). */
export function prisma(): ReturnType<typeof getPrisma> {
  return getPrisma();
}

before(async () => {
  await ensureIsolatedDatabase();
});

/** Очищает все таблицы в порядке, безопасном для FK. */
export async function resetTestData(): Promise<void> {
  await ensureIsolatedDatabase();
  const db = getPrisma();
  await db.auditEvent.deleteMany();
  await db.notification.deleteMany();
  await db.session.deleteMany();
  await db.announcement.deleteMany();
  await db.request.deleteMany();
  await db.grade.deleteMany();
  await db.scheduleEntry.deleteMany();
  await db.studentVerification.deleteMany();
  await db.oAuthAccount.deleteMany();
  await db.oAuthIntent.deleteMany();
  await db.botLinkCode.deleteMany();
  await db.channelDelivery.deleteMany();
  await db.sickLeave.deleteMany();
  await db.officeHour.deleteMany();
  await db.identityRegistry.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.studyPlan.deleteMany();
  await db.student.deleteMany();
  await db.teacher.deleteMany();
  await db.subject.deleteMany();
  await db.group.deleteMany();
  await db.auditEvent.deleteMany();
  await db.user.deleteMany();
}

/** Закрывает подключение теста к базе (хук after). */
export async function closeTestDb(): Promise<void> {
  await getPrisma().$disconnect();
  if (storageDir !== null) {
    await rm(storageDir, { recursive: true, force: true });
    storageDir = null;
  }
}

// ---------------------------------------------------------------------------
// Фикстуры (вымышленные данные)
// ---------------------------------------------------------------------------

export const FACULTY = 'Институт математики, информационных технологий и физики';
export const OTHER_FACULTY = 'Институт языка и литературы';

export const STAFF_LOGIN = 'staff-mcp';
export const ADMIN_LOGIN = 'admin-mcp';
export const STUDENT_LOGIN = 'student-mcp';
export const OTHER_STUDENT_LOGIN = 'student-mcp-other';
export const TEACHER_LOGIN = 'teacher-mcp';

export interface McpFixtures {
  readonly staffToken: string;
  readonly adminToken: string;
  readonly studentToken: string;
  readonly teacherToken: string;
  readonly ownRequestId: string;
  readonly otherRequestId: string;
  readonly ownLessonId: string;
  readonly ownGroupId: string;
  readonly otherLessonId: string;
  readonly teacherId: string;
  readonly subjectId: string;
  readonly ownStudentUserId: string;
}

/** Пользователь с паролем (боевой hashPassword — argon2id). */
async function createUser(
  login: string,
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
  faculty: string | null,
): Promise<string> {
  const user = await getPrisma().user.create({
    data: { login, passwordHash: await hashPassword('fixture-password'), role, faculty },
    select: { id: true },
  });
  return user.id;
}

/** Токен сессии пользователя (боевой createSession — как после входа). */
async function tokenFor(userId: string): Promise<string> {
  const { token } = await createSession(userId, { ip: '127.0.0.1', userAgent: 'mcp:test' });
  return token;
}

/** Дата в полночь UTC — как их хранит Prisma для @db.Date. */
function utcDay(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/**
 * Полный набор фикстур: два института, студенты с оценками, сотрудник
 * своего института, админ, преподаватель, заявки, пара на сегодня,
 * болезнь своего студента и пара чужого института (для отказа по
 * факультету).
 */
export async function createFixtures(): Promise<McpFixtures> {
  await resetTestData();

  const db = getPrisma();

  const ownGroup = await db.group.create({
    data: {
      name: 'МСР-31-1',
      faculty: FACULTY,
      course: 3,
      direction: '09.03.03 Прикладная информатика',
    },
    select: { id: true },
  });
  const otherGroup = await db.group.create({
    data: {
      name: 'МСР-ЯЗ-21-1',
      faculty: OTHER_FACULTY,
      course: 2,
      direction: '45.03.01 Филология',
    },
    select: { id: true },
  });

  const ownStudent = await db.student.create({
    data: {
      userId: await createUser(STUDENT_LOGIN, 'STUDENT', null),
      lastName: 'Иванов',
      firstName: 'Александр',
      middleName: 'Дмитриевич',
      faculty: FACULTY,
      direction: '09.03.03 Прикладная информатика',
      course: 3,
      groupId: ownGroup.id,
      email: `${STUDENT_LOGIN}@udsu.ru`,
      studentCardNumber: 'МСР-2023-001',
    },
    select: { id: true, userId: true },
  });
  const otherStudent = await db.student.create({
    data: {
      userId: await createUser(OTHER_STUDENT_LOGIN, 'STUDENT', null),
      lastName: 'Кузнецова',
      firstName: 'Анна',
      middleName: 'Сергеевна',
      faculty: OTHER_FACULTY,
      direction: '45.03.01 Филология',
      course: 2,
      groupId: otherGroup.id,
      email: `${OTHER_STUDENT_LOGIN}@udsu.ru`,
      studentCardNumber: 'МСР-2023-002',
    },
    select: { id: true, userId: true },
  });

  const staffUserId = await createUser(STAFF_LOGIN, 'STAFF', FACULTY);
  const adminUserId = await createUser(ADMIN_LOGIN, 'ADMIN', null);

  // Оценки своего студента: два экзамена + незачёт (долг).
  const subject = await db.subject.create({
    data: { code: 'МСР-101', name: 'Базы данных', faculty: FACULTY },
    select: { id: true },
  });
  const subject2 = await db.subject.create({
    data: { code: 'МСР-102', name: 'Веб-программирование', faculty: FACULTY },
    select: { id: true },
  });
  await db.grade.createMany({
    data: [
      { studentId: ownStudent.id, subjectId: subject.id, value: 5, type: 'EXAM', date: utcDay('2026-06-10'), semester: 2 },
      { studentId: ownStudent.id, subjectId: subject2.id, value: 4, type: 'EXAM', date: utcDay('2026-06-12'), semester: 2 },
      { studentId: ownStudent.id, subjectId: subject.id, value: null, passed: false, type: 'CREDIT', date: utcDay('2025-12-20'), semester: 1 },
    ],
  });
  // Оценка студента чужого института: сотрудник её видеть не должен.
  const otherSubject = await db.subject.create({
    data: { code: 'МСР-ЯЗ-101', name: 'Филология', faculty: OTHER_FACULTY },
    select: { id: true },
  });
  await db.grade.create({
    data: { studentId: otherStudent.id, subjectId: otherSubject.id, value: 3, type: 'EXAM', date: utcDay('2026-06-11'), semester: 2 },
  });

  // Заявки: своя (NEW) и чужая (NEW).
  const ownRequest = await db.request.create({
    data: {
      studentId: ownStudent.id,
      type: 'REFERENCE',
      status: 'NEW',
      formData: { purpose: 'в банк' },
    },
    select: { id: true },
  });
  const otherRequest = await db.request.create({
    data: {
      studentId: otherStudent.id,
      type: 'APPLICATION',
      status: 'NEW',
      formData: { purpose: 'перевод' },
    },
    select: { id: true },
  });

  // Преподаватель и пара своей группы на сегодня.
  const teacher = await db.teacher.create({
    data: {
      userId: await createUser(TEACHER_LOGIN, 'STAFF', null),
      lastName: 'Преподавательская',
      firstName: 'Ольга',
      middleName: 'Игоревна',
      department: 'Кафедра информационных технологий',
      position: 'доцент',
    },
    select: { id: true, userId: true },
  });
  const teacherUserId = teacher.userId;
  const today = new Date().toISOString().slice(0, 10);
  const lesson = await db.scheduleEntry.create({
    data: {
      groupId: ownGroup.id,
      subjectId: subject.id,
      teacherId: teacher.id,
      date: utcDay(today),
      startTime: '10:00',
      endTime: '11:20',
      room: 'У-101',
      type: 'LECTURE',
      status: 'SCHEDULED',
    },
    select: { id: true },
  });

  // Пара чужого института: сотрудник не должен её ни перенести, ни отменить.
  const otherLesson = await db.scheduleEntry.create({
    data: {
      groupId: otherGroup.id,
      subjectId: otherSubject.id,
      teacherId: teacher.id,
      date: utcDay(today),
      startTime: '12:00',
      endTime: '13:20',
      room: 'Я-101',
      type: 'LECTURE',
      status: 'SCHEDULED',
    },
    select: { id: true },
  });

  // Болезнь своего студента на сегодня: sick_statuses(activeOnly) — реальные данные.
  await db.sickLeave.create({
    data: {
      studentId: ownStudent.id,
      dateFrom: utcDay(today),
      dateTo: utcDay(today),
      reason: 'ОРВИ',
    },
  });

  return {
    staffToken: await tokenFor(staffUserId),
    adminToken: await tokenFor(adminUserId),
    studentToken: await tokenFor(ownStudent.userId),
    teacherToken: await tokenFor(teacherUserId),
    ownRequestId: ownRequest.id,
    otherRequestId: otherRequest.id,
    ownLessonId: lesson.id,
    ownGroupId: ownGroup.id,
    otherLessonId: otherLesson.id,
    teacherId: teacher.id,
    subjectId: subject.id,
    ownStudentUserId: ownStudent.userId,
  };
}

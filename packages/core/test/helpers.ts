/**
 * Общий помощник тестов packages/core.
 *
 * Два подхода, которые здесь сочетаются:
 * - «чистые» модули (password, ratelimit, ownership, mockOcr, leverage)
 *   тестируются без БД вообще;
 * - сервисы и сессии тестируются на ОТДЕЛЬНОЙ тестовой базе horizon_test
 *   (DATABASE_URL_TEST): перед каждым файлом таблицы очищаются, после —
 *   подключение закрывается. Прод-база horizon тестами не трогается:
 *   клиент создаётся лениво, а этот модуль переключает DATABASE_URL на
 *   тестовую ДО первого обращения к сервисам.
 *
 * Тесты гоняются с --test-concurrency=1 (см. package.json): общая база
 * на время прогона принадлежит одному файлу.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../src/db';

const coreDir = path.dirname(fileURLToPath(import.meta.url));

/** Читает корневой .env (process.loadEnvFile — Node 20.12+). */
function loadRootEnv(): void {
  const envPath = path.resolve(coreDir, '../../.env');
  try {
    process.loadEnvFile(envPath);
  } catch {
    // .env нет — переменные должны прийти из окружения.
  }
}

loadRootEnv();

const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/horizon_test?schema=public';

// Переключаем приложение на тестовую базу ДО любого вызова сервисов.
process.env.DATABASE_URL = TEST_DATABASE_URL;

export { TEST_DATABASE_URL };

/** Очищает все таблицы в порядке, безопасном для FK. */
export async function resetTestData(): Promise<void> {
  await prisma().auditEvent.deleteMany();
  await prisma().notification.deleteMany();
  await prisma().session.deleteMany();
  await prisma().announcement.deleteMany();
  await prisma().request.deleteMany();
  await prisma().grade.deleteMany();
  await prisma().scheduleEntry.deleteMany();
  await prisma().studentVerification.deleteMany();
  await prisma().oAuthAccount.deleteMany();
  await prisma().oAuthIntent.deleteMany();
  await prisma().sickLeave.deleteMany();
  await prisma().officeHour.deleteMany();
  await prisma().identityRegistry.deleteMany();
  // Переписка: сообщения ссылаются на диалог И на автора (User) —
  // чистим до студентов, преподавателей и пользователей.
  await prisma().message.deleteMany();
  await prisma().conversation.deleteMany();
  await prisma().student.deleteMany();
  await prisma().teacher.deleteMany();
  await prisma().subject.deleteMany();
  await prisma().group.deleteMany();
  await prisma().user.deleteMany();
}

/** Закрывает подключение к тестовой базе (хук after). */
export async function closeTestDb(): Promise<void> {
  await prisma().$disconnect();
}

// ---------------------------------------------------------------------------
// Фикстуры
// ---------------------------------------------------------------------------

/** Пароль тестовых аккаунтов: хешируется через боевой hashPassword. */
export const TEST_PASSWORD = 'test-password-123';

export interface CreatedUser {
  readonly id: string;
  readonly login: string;
  readonly password: string;
}

export async function createUser(
  login: string,
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
  password: string = TEST_PASSWORD,
): Promise<CreatedUser> {
  const { hashPassword } = await import('../src/password');
  const user = await prisma().user.create({
    data: { login, passwordHash: await hashPassword(password), role },
    select: { id: true, login: true },
  });
  return { id: user.id, login: user.login, password };
}

export interface CreatedGroup {
  readonly id: string;
  readonly name: string;
}

export async function createGroup(
  name: string,
  faculty = 'Институт математики, информационных технологий и физики',
  course = 3,
  direction = '09.03.03 Прикладная информатика',
): Promise<CreatedGroup> {
  const group = await prisma().group.create({
    data: { name, faculty, course, direction },
    select: { id: true, name: true },
  });
  return { id: group.id, name: group.name };
}

export interface CreatedStudent {
  readonly userId: string;
  readonly studentId: string;
  readonly login: string;
}

/**
 * Счётчик для уникальных номеров зачёток: в рамках одного файла тестов
 * база очищается, поэтому счётчик от 0 не даёт коллизий.
 */
let studentCardSerial = 0;

export async function createStudent(
  login: string,
  groupId: string,
  overrides: {
    lastName?: string;
    firstName?: string;
    middleName?: string | null;
    faculty?: string;
    direction?: string;
    course?: number;
    email?: string;
    studentCardNumber?: string;
    phone?: string | null;
  } = {},
): Promise<CreatedStudent> {
  const user = await createUser(login, 'STUDENT');
  const student = await prisma().student.create({
    data: {
      userId: user.id,
      lastName: overrides.lastName ?? 'Иванов',
      firstName: overrides.firstName ?? 'Александр',
      middleName: overrides.middleName === undefined ? 'Дмитриевич' : overrides.middleName,
      faculty: overrides.faculty ?? 'Институт математики, информационных технологий и физики',
      direction: overrides.direction ?? '09.03.03 Прикладная информатика',
      course: overrides.course ?? 3,
      groupId,
      email: overrides.email ?? `${login}@udsu.ru`,
      studentCardNumber: overrides.studentCardNumber ?? `UDGU-2023-${String(++studentCardSerial).padStart(3, '0')}`,
      phone: overrides.phone ?? null,
    },
    select: { id: true },
  });
  return { userId: user.id, studentId: student.id, login };
}

export async function createTeacher(login: string): Promise<{ userId: string; teacherId: string }> {
  const user = await createUser(login, 'STAFF');
  const teacher = await prisma().teacher.create({
    data: {
      userId: user.id,
      lastName: 'Преподавательская',
      firstName: 'Ольга',
      middleName: 'Игоревна',
      department: 'Кафедра информационных технологий',
      position: 'доцент',
    },
    select: { id: true },
  });
  return { userId: user.id, teacherId: teacher.id };
}

export async function createSubject(code: string, name: string): Promise<string> {
  const subject = await prisma().subject.create({
    data: { code, name, faculty: 'Институт математики, информационных технологий и физики' },
    select: { id: true },
  });
  return subject.id;
}

/** Дата в полночь UTC — как их хранит Prisma для @db.Date. */
export function utcDay(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export interface CreateScheduleEntryInput {
  groupId: string;
  subjectId: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
  type?: 'LECTURE' | 'SEMINAR' | 'LAB';
  status?: 'SCHEDULED' | 'MOVED' | 'CANCELLED';
  note?: string | null;
  movedToDate?: string | null;
  movedToRoom?: string | null;
}

export async function createScheduleEntry(input: CreateScheduleEntryInput): Promise<string> {
  const entry = await prisma().scheduleEntry.create({
    data: {
      groupId: input.groupId,
      subjectId: input.subjectId,
      teacherId: input.teacherId,
      date: utcDay(input.date),
      startTime: input.startTime,
      endTime: input.endTime,
      room: input.room ?? 'У-101',
      type: input.type ?? 'LECTURE',
      status: input.status ?? 'SCHEDULED',
      note: input.note ?? null,
      movedToDate: input.movedToDate === null || input.movedToDate === undefined ? null : utcDay(input.movedToDate),
      movedToRoom: input.movedToRoom ?? null,
    },
    select: { id: true },
  });
  return entry.id;
}

export interface CreateGradeInput {
  studentId: string;
  subjectId: string;
  value: number | null;
  passed?: boolean | null;
  type: 'EXAM' | 'CREDIT' | 'COURSEWORK';
  date: string;
  semester: number;
}

export async function createGrade(input: CreateGradeInput): Promise<string> {
  const grade = await prisma().grade.create({
    data: {
      studentId: input.studentId,
      subjectId: input.subjectId,
      value: input.value,
      passed: input.passed ?? null,
      type: input.type,
      date: utcDay(input.date),
      semester: input.semester,
    },
    select: { id: true },
  });
  return grade.id;
}

export async function createNotification(
  userId: string,
  overrides: {
    type?: 'SCHEDULE_CHANGE' | 'GRADE' | 'REQUEST_STATUS' | 'ANNOUNCEMENT' | 'DEADLINE' | 'SYSTEM';
    title?: string;
    body?: string;
    read?: boolean;
    link?: string | null;
  } = {},
): Promise<string> {
  const notification = await prisma().notification.create({
    data: {
      userId,
      type: overrides.type ?? 'SYSTEM',
      title: overrides.title ?? 'Уведомление',
      body: overrides.body ?? 'Текст уведомления',
      read: overrides.read ?? false,
      link: overrides.link ?? null,
    },
    select: { id: true },
  });
  return notification.id;
}

export async function createIdentityRegistryEntry(input: {
  cardNumber: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  groupId: string;
  groupName: string;
}): Promise<void> {
  await prisma().identityRegistry.create({
    data: {
      cardNumber: input.cardNumber,
      lastName: input.lastName,
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      groupId: input.groupId,
      faculty: 'Институт математики, информационных технологий и физики',
      program: '09.03.03 Прикладная информатика',
      course: 3,
      issuedAt: utcDay('2024-09-01'),
    },
  });
}

export async function createOfficeHour(
  teacherId: string,
  input: { weekday: number; startTime: string; endTime: string; room?: string; type?: 'CONSULTATION' | 'RECEPTION' | 'EXTRA_CLASS'; note?: string | null },
): Promise<string> {
  const hour = await prisma().officeHour.create({
    data: {
      teacherId,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      room: input.room ?? 'У-204',
      type: input.type ?? 'CONSULTATION',
      note: input.note ?? null,
    },
    select: { id: true },
  });
  return hour.id;
}

export async function createSickLeave(
  studentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<string> {
  const leave = await prisma().sickLeave.create({
    data: { studentId, dateFrom: utcDay(dateFrom), dateTo: utcDay(dateTo) },
    select: { id: true },
  });
  return leave.id;
}

/** Сессия пользователя для тестов сервисов (создаётся боевым createSession). */
export async function createSessionFor(userId: string): Promise<string> {
  const { createSession } = await import('../src/session');
  const { token } = await createSession(userId, { ip: '127.0.0.1', userAgent: 'node:test' });
  return token;
}

/** Валидная сессия (AuthSession) пользователя для вызовов сервисов. */
export async function authSessionFor(userId: string) {
  const { validateSession } = await import('../src/session');
  const token = await createSessionFor(userId);
  const session = await validateSession(token);
  if (session === null) {
    throw new Error('Тест: не удалось создать сессию');
  }
  return session;
}

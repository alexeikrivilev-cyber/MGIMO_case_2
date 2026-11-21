/**
 * Тесты кабинета сотрудника деканата: faculty-scope, решения по заявкам,
 * объявления, перенос/отмена пар, болезни, очередь верификаций и фото
 * студбилета из приватного хранилища.
 *
 * Проверяемые инварианты (ARCHITECTURE §4, ACCEPTANCE):
 *   - сотрудник видит ТОЛЬКО свой факультет; ADMIN — все;
 *   - преподаватель (STAFF без faculty) → STAFF_ONLY (на роуте → 404);
 *   - студент → STAFF_ONLY;
 *   - чужая сущность по идентификатору → NOT_OWNER (единый ответ);
 *   - REJECTED по заявке без комментария → ValidationError;
 *   - терминальные статусы (READY/REJECTED) не меняются;
 *   - каждая мутация: уведомление + аудит.
 *
 * Фото пишутся во временный каталог (STORAGE_DIR) — хранилище репозитория
 * не трогается.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getStaffDashboard,
  listStaffRequests,
  decideStaffRequest,
  listStaffAnnouncements,
  createStaffAnnouncement,
  listStaffSchedule,
  moveStaffLesson,
  cancelStaffLesson,
  listStaffSickLeaves,
  listStaffVerifications,
  getStaffVerificationPhoto,
  decideStaffVerification,
  createMyRequest,
  createMySickLeave,
  OwnershipError,
  ValidationError,
  dateKey,
  startOfUtcDay,
  idCardPhotoRelativePath,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createUser,
  createSubject,
  createScheduleEntry,
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';

const FACULTY = 'Институт математики, информационных технологий и физики';
const OTHER_FACULTY = 'Институт языка и литературы';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

let storageDir: string;
let previousStorageDir: string | undefined;

/** Сессии и фикстуры, общие для всех тестов файла. */
let staffSession: AuthSession;
let otherStaffSession: AuthSession;
let adminSession: AuthSession;
let teacherSession: AuthSession;
let studentSession: AuthSession;
let ownStudentId: string;
let otherStudentId: string;
let ownRequestId: string;
let otherRequestId: string;
let ownEntryId: string;
let otherEntryId: string;
let ownVerificationId: string;
let otherVerificationId: string;

async function staffUserId(login: string): Promise<string> {
  const user = await prisma().user.findUniqueOrThrow({ where: { login }, select: { id: true } });
  return user.id;
}

async function studentUserId(studentId: string): Promise<string> {
  const student = await prisma().student.findUniqueOrThrow({
    where: { id: studentId },
    select: { userId: true },
  });
  return student.userId;
}

test.before(async () => {
  await resetTestData();

  previousStorageDir = process.env.STORAGE_DIR;
  storageDir = await mkdtemp(join(tmpdir(), 'udgu-staff-'));
  process.env.STORAGE_DIR = storageDir;

  // Группы двух факультетов: сотрудник видит только первую.
  const ownGroup = await createGroup('СТА-31-1', FACULTY);
  const ownGroup2 = await createGroup('СТА-31-2', FACULTY, 3, '01.03.02 Прикладная математика и информатика');
  const otherGroup = await createGroup('СТА-ЯЗ-21-1', OTHER_FACULTY, 2, '45.03.01 Филология');

  const ownStudent = await createStudent('student-own', ownGroup.id, { lastName: 'Свой' });
  const ownStudent2 = await createStudent('student-own2', ownGroup.id, { lastName: 'СвойВторой' });
  const otherStudent = await createStudent('student-other', otherGroup.id, {
    lastName: 'Чужой',
    faculty: OTHER_FACULTY,
  });
  ownStudentId = ownStudent.studentId;
  otherStudentId = otherStudent.studentId;

  // Сотрудник деканата своего факультета, сотрудник чужого, админ и преподаватель.
  const staff = await createUser('staff-own', 'STAFF');
  await prisma().user.update({ where: { id: staff.id }, data: { faculty: FACULTY } });
  const otherStaff = await createUser('staff-other', 'STAFF');
  await prisma().user.update({ where: { id: otherStaff.id }, data: { faculty: OTHER_FACULTY } });
  const admin = await createUser('admin-staff', 'ADMIN');
  const teacher = await createUser('teacher-staff', 'STAFF'); // faculty = null → преподаватель

  staffSession = await authSessionFor(staff.id);
  otherStaffSession = await authSessionFor(otherStaff.id);
  adminSession = await authSessionFor(admin.id);
  teacherSession = await authSessionFor(teacher.id);
  studentSession = await authSessionFor(ownStudent.userId);

  // Заявки: своя и чужая.
  const ownRequest = await createMyRequest(await authSessionFor(ownStudent.userId), {
    type: 'REFERENCE',
    formData: { purpose: 'в банк' },
  });
  ownRequestId = ownRequest.id;
  const otherRequest = await createMyRequest(await authSessionFor(otherStudent.userId), {
    type: 'APPLICATION',
    formData: { purpose: 'перевод' },
  });
  otherRequestId = otherRequest.id;

  // Расписание: пара своей группы и пара чужой.
  const subject = await createSubject('СТА-101', 'Базы данных');
  const teacherProfile = await prisma().teacher.create({
    data: {
      userId: teacher.id,
      lastName: 'Преподавательская',
      firstName: 'Ольга',
      middleName: 'Игоревна',
      department: 'Кафедра информационных технологий',
      position: 'доцент',
    },
    select: { id: true },
  });
  const today = dateKey(startOfUtcDay(new Date()));
  ownEntryId = await createScheduleEntry({
    groupId: ownGroup.id,
    subjectId: subject,
    teacherId: teacherProfile.id,
    date: today,
    startTime: '10:00',
    endTime: '11:20',
  });
  otherEntryId = await createScheduleEntry({
    groupId: otherGroup.id,
    subjectId: subject,
    teacherId: teacherProfile.id,
    date: today,
    startTime: '10:00',
    endTime: '11:20',
  });
  // Отменённая пара на сегодня в другой группе своего факультета:
  // дашборд должен показать «изменения на сегодня», но очередь
  // расписания сотрудника не смешает её с парой 10:00 (слот 12:00).
  await createScheduleEntry({
    groupId: ownGroup2.id,
    subjectId: subject,
    teacherId: teacherProfile.id,
    date: today,
    startTime: '12:00',
    endTime: '13:20',
    status: 'CANCELLED',
    note: 'отмена по приказу',
  });

  // Болезнь: студент своей группы болеет сегодня.
  await createMySickLeave(await authSessionFor(ownStudent2.userId), {
    dateFrom: today,
    dateTo: today,
    reason: 'ОРВИ',
  });

  // Верификации: своя и чужая (файлы — в тестовом хранилище).
  async function createVerification(studentId: string, login: string): Promise<string> {
    const photoPath = idCardPhotoRelativePath(studentId, 'card.jpg');
    await mkdir(join(storageDir, photoPath.slice(0, photoPath.lastIndexOf('/'))), { recursive: true });
    await writeFile(join(storageDir, photoPath), JPEG);
    const verification = await prisma().studentVerification.create({
      data: {
        studentId,
        status: 'PENDING',
        idCardPhotoPath: photoPath,
        recognizedLastName: login,
        recognizedFirstName: 'Иван',
        recognizedGroupName: 'группа',
        recognizedCardNumber: 'ПИ-2023-0001',
        matchScore: 0.9,
      },
      select: { id: true },
    });
    return verification.id;
  }
  ownVerificationId = await createVerification(ownStudent.studentId, 'Свой');
  otherVerificationId = await createVerification(otherStudent.studentId, 'Чужой');
});

test.after(async () => {
  if (previousStorageDir === undefined) {
    delete process.env.STORAGE_DIR;
  } else {
    process.env.STORAGE_DIR = previousStorageDir;
  }
  await rm(storageDir, { recursive: true, force: true });
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Faculty-scope: кто вообще попадает в кабинет деканата
// ---------------------------------------------------------------------------

test('кабинет деканата: преподаватель (STAFF без faculty) и студент → STAFF_ONLY', async () => {
  for (const [session, label] of [
    [teacherSession, 'преподаватель'],
    [studentSession, 'студент'],
  ] as const) {
    await assert.rejects(
      () => getStaffDashboard(session),
      (error: unknown) => error instanceof OwnershipError && error.code === 'STAFF_ONLY',
      `${label} не должен попадать в кабинет деканата`,
    );
  }
});

test('дашборд: счётчики сотрудника — только его факультет', async () => {
  const dashboard = await getStaffDashboard(staffSession);
  assert.equal(dashboard.faculty, FACULTY);
  assert.equal(dashboard.newRequests, 1, 'новая заявка своего факультета');
  assert.equal(dashboard.pendingVerifications, 1, 'верификация на проверке');
  assert.equal(dashboard.sickNow, 1, 'один студент болеет сегодня');
  assert.ok(dashboard.todayScheduleChanges >= 1, 'на сегодня есть перенос/отмена');

  // Админ видит все факультеты.
  const adminDashboard = await getStaffDashboard(adminSession);
  assert.equal(adminDashboard.faculty, null);
  assert.equal(adminDashboard.newRequests, 2, 'админ видит заявки всех факультетов');
  assert.equal(adminDashboard.pendingVerifications, 2);
  assert.equal(adminDashboard.sickNow, 1);
});

// ---------------------------------------------------------------------------
// Заявки: очередь и решения
// ---------------------------------------------------------------------------

test('очередь заявок: сотрудник видит только свой факультет, админ — все', async () => {
  const staffRequests = await listStaffRequests(staffSession);
  assert.equal(staffRequests.length, 1);
  assert.equal(staffRequests[0]?.id, ownRequestId);
  assert.match(staffRequests[0]?.student.fullName ?? '', /Свой/);
  assert.equal(staffRequests[0]?.student.groupName, 'СТА-31-1');

  const otherStaffRequests = await listStaffRequests(otherStaffSession);
  assert.equal(otherStaffRequests.length, 1);
  assert.equal(otherStaffRequests[0]?.id, otherRequestId, 'сотрудник другого факультета не видит наших заявок');

  const adminRequests = await listStaffRequests(adminSession);
  assert.equal(adminRequests.length, 2, 'админ видит заявки всех факультетов');
});

test('решение по заявке: чужая → NOT_OWNER (единый ответ с «не существует»)', async () => {
  await assert.rejects(
    () => decideStaffRequest(staffSession, otherRequestId, { status: 'IN_PROGRESS' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
  // Несуществующий идентификатор — тот же код: ответ не различает «нет» и «не твоя».
  await assert.rejects(
    () => decideStaffRequest(staffSession, '00000000-0000-0000-0000-000000000000', { status: 'IN_PROGRESS' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
});

test('решение по заявке: REJECTED без комментария → ValidationError', async () => {
  await assert.rejects(
    () => decideStaffRequest(staffSession, ownRequestId, { status: 'REJECTED' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    () => decideStaffRequest(staffSession, ownRequestId, { status: 'REJECTED', staffComment: '   ' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
});

test('решение по заявке: корректные переходы, уведомление студенту, аудит', async () => {
  const inProgress = await decideStaffRequest(staffSession, ownRequestId, { status: 'IN_PROGRESS' });
  assert.equal(inProgress.status, 'IN_PROGRESS');
  assert.equal(inProgress.statusLabel, 'В работе');

  // Повторный переход в тот же статус — CONFLICT (не плодим уведомления).
  await assert.rejects(
    () => decideStaffRequest(staffSession, ownRequestId, { status: 'IN_PROGRESS' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );

  const ready = await decideStaffRequest(staffSession, ownRequestId, { status: 'READY' });
  assert.equal(ready.status, 'READY');

  // Из терминального READY дальше нельзя.
  await assert.rejects(
    () => decideStaffRequest(staffSession, ownRequestId, { status: 'REJECTED', staffComment: 'передумали' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );

  // Уведомления студенту: создание + IN_PROGRESS + READY.
  const notifications = await prisma().notification.findMany({
    where: { userId: await studentUserId(ownStudentId) },
    orderBy: { createdAt: 'asc' },
  });
  const requestNotifications = notifications.filter((n) => n.type === 'REQUEST_STATUS');
  assert.equal(requestNotifications.length, 3, 'создание + два решения сотрудника');
  assert.match(requestNotifications[1]?.title ?? '', /взята в работу/);
  assert.match(requestNotifications[2]?.title ?? '', /готова/);

  // Аудит решений сотрудника.
  const audit = await prisma().auditEvent.findMany({
    where: { entity: 'Request', entityId: ownRequestId, action: 'request.decide' },
  });
  assert.equal(audit.length, 2);
  assert.equal(audit[0]?.actorUserId, await staffUserId('staff-own'));
});

test('отклонение заявки из NEW: комментарий обязателен и доходит до студента', async () => {
  const freshRequest = await createMyRequest(studentSession, {
    type: 'REFERENCE',
    formData: { purpose: 'для общежития' },
  });
  const rejected = await decideStaffRequest(staffSession, freshRequest.id, {
    status: 'REJECTED',
    staffComment: 'нет подтверждения проживания',
  });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.staffComment, 'нет подтверждения проживания');

  const notification = await prisma().notification.findFirst({
    where: { userId: await studentUserId(ownStudentId), type: 'REQUEST_STATUS' },
    orderBy: { createdAt: 'desc' },
  });
  assert.match(notification?.body ?? '', /нет подтверждения проживания/);
});

// ---------------------------------------------------------------------------
// Объявления
// ---------------------------------------------------------------------------

test('объявление: STAFF публикует в СВОЙ факультет (не клиентский), GROUP — только свой', async () => {
  const facultyAnnouncement = await createStaffAnnouncement(staffSession, {
    title: 'Сдача сессии',
    body: 'Расписание сессии опубликовано.',
    audience: 'FACULTY',
  });
  assert.equal(facultyAnnouncement.faculty, FACULTY, 'факультет берётся из сессии');
  assert.equal(facultyAnnouncement.groupName, null);

  // STAFF не может вещать на весь университет: ALL — только ADMIN.
  await assert.rejects(
    () => createStaffAnnouncement(staffSession, { title: 'Всем', body: 'Текст', audience: 'ALL' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );

  // STAFF не может публиковать в чужую группу (NOT_OWNER → 404).
  const otherGroup = await prisma().group.findUniqueOrThrow({ where: { name: 'СТА-ЯЗ-21-1' } });
  await assert.rejects(
    () => createStaffAnnouncement(staffSession, {
      title: 'Для чужой группы',
      body: 'Текст',
      audience: 'GROUP',
      groupId: otherGroup.id,
    }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Своя группа — можно.
  const ownGroup = await prisma().group.findUniqueOrThrow({ where: { name: 'СТА-31-1' } });
  const groupAnnouncement = await createStaffAnnouncement(staffSession, {
    title: 'Экзамен',
    body: 'Экзамен в пятницу.',
    audience: 'GROUP',
    groupId: ownGroup.id,
  });
  assert.equal(groupAnnouncement.groupName, 'СТА-31-1');
  assert.equal(groupAnnouncement.faculty, FACULTY);

  // Уведомления студентам аудитории: FACULTY (2 студента) + GROUP (2 студента).
  const ownUserIds = [
    await studentUserId(ownStudentId),
    await studentUserId(
      (await prisma().student.findFirstOrThrow({ where: { lastName: 'СвойВторой' }, select: { id: true } })).id,
    ),
  ];
  for (const userId of ownUserIds) {
    const announcements = await prisma().notification.findMany({
      where: { userId, type: 'ANNOUNCEMENT' },
    });
    assert.equal(announcements.length, 2, 'каждый студент факультета получил оба объявления');
  }
  // Студент чужого факультета не получил ничего.
  const otherNotifications = await prisma().notification.count({
    where: { userId: await studentUserId(otherStudentId), type: 'ANNOUNCEMENT' },
  });
  assert.equal(otherNotifications, 0);

  // Аудит публикаций.
  const audit = await prisma().auditEvent.count({
    where: { entity: 'Announcement', action: 'announcement.create' },
  });
  assert.equal(audit, 2);

  // Список сотрудника: ALL + свой факультет (включая чужие ALL-объявления).
  const list = await listStaffAnnouncements(staffSession);
  assert.equal(list.length, 2);
  const adminAll = await createStaffAnnouncement(adminSession, {
    title: 'Всем',
    body: 'Общее объявление.',
    audience: 'ALL',
  });
  assert.equal(adminAll.faculty, null);
  const listAfter = await listStaffAnnouncements(staffSession);
  assert.equal(listAfter.length, 3, 'сотрудник видит и общие объявления');
  const otherStaffList = await listStaffAnnouncements(otherStaffSession);
  assert.equal(otherStaffList.length, 1, 'сотрудник другого факультета видит только общее');
});

// ---------------------------------------------------------------------------
// Расписание: перенос и отмена
// ---------------------------------------------------------------------------

test('расписание сотрудника: пары своего факультета, перенос и отмена', async () => {
  const today = dateKey(startOfUtcDay(new Date()));
  const lessons = await listStaffSchedule(staffSession, { from: today, to: today });
  assert.equal(lessons.length, 2, 'пара 10:00 + отменённая пара 12:00 своего факультета');
  assert.equal(lessons[0]?.id, ownEntryId);
  assert.equal(lessons[0]?.groupName, 'СТА-31-1');

  // Чужая пара по идентификатору → NOT_OWNER (404).
  await assert.rejects(
    () => moveStaffLesson(staffSession, otherEntryId, { date: today, room: 'У-999' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  const moved = await moveStaffLesson(staffSession, ownEntryId, {
    date: today,
    room: 'У-205',
    note: 'перенос по заявке деканата',
  });
  assert.equal(moved.status, 'MOVED');
  assert.equal(moved.movedToRoom, 'У-205');
  assert.equal(moved.note, 'перенос по заявке деканата');

  // Уведомление группе (SCHEDULE_CHANGE).
  const ownGroup = await prisma().group.findUniqueOrThrow({ where: { name: 'СТА-31-1' } });
  const students = await prisma().student.findMany({ where: { groupId: ownGroup.id }, select: { userId: true } });
  for (const student of students) {
    const change = await prisma().notification.findFirst({
      where: { userId: student.userId, type: 'SCHEDULE_CHANGE' },
    });
    assert.ok(change !== null, 'студент группы уведомлён о переносе');
    assert.match(change.title ?? '', /перенесена/i);
  }

  // Аудит переноса.
  const moveAudit = await prisma().auditEvent.count({
    where: { entity: 'ScheduleEntry', entityId: ownEntryId, action: 'schedule.move' },
  });
  assert.equal(moveAudit, 1);

  // Отмена с причиной.
  const cancelled = await cancelStaffLesson(staffSession, ownEntryId, { reason: 'отмена по болезни преподавателя' });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.note, 'отмена по болезни преподавателя');

  // Повторное изменение невозможно: CANCELLED — терминальный статус.
  await assert.rejects(
    () => cancelStaffLesson(staffSession, ownEntryId, { reason: 'ещё раз' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );
  await assert.rejects(
    () => moveStaffLesson(staffSession, ownEntryId, { date: today }),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );

  // Отмена без причины → ValidationError.
  await assert.rejects(
    () => cancelStaffLesson(staffSession, otherEntryId, { reason: '' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );

  const cancelAudit = await prisma().auditEvent.count({
    where: { entity: 'ScheduleEntry', entityId: ownEntryId, action: 'schedule.cancel' },
  });
  assert.equal(cancelAudit, 1);
});

// ---------------------------------------------------------------------------
// Болезни
// ---------------------------------------------------------------------------

test('болезни: сотрудник видит только свой факультет, фото справки не отдаётся', async () => {
  const staffLeaves = await listStaffSickLeaves(staffSession, { onlyActive: true });
  assert.equal(staffLeaves.length, 1);
  assert.match(staffLeaves[0]?.fullName ?? '', /СвойВторой/);
  assert.equal(staffLeaves[0]?.groupName, 'СТА-31-1');
  assert.equal(staffLeaves[0]?.hasAttachment, false, 'факт наличия справки');
  assert.ok(!('attachmentPath' in staffLeaves[0]!), 'путь к файлу не уходит клиенту');

  const otherStaffLeaves = await listStaffSickLeaves(otherStaffSession, { onlyActive: true });
  assert.equal(otherStaffLeaves.length, 0);

  const adminLeaves = await listStaffSickLeaves(adminSession, { onlyActive: true });
  assert.equal(adminLeaves.length, 1, 'админ видит все факультеты');
});

// ---------------------------------------------------------------------------
// Верификации: очередь и фото
// ---------------------------------------------------------------------------

test('верификации: очередь PENDING, фото — только своего факультета', async () => {
  const queue = await listStaffVerifications(staffSession);
  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.id, ownVerificationId);
  assert.equal(queue[0]?.status, 'PENDING');
  assert.equal(queue[0]?.matchScore, 0.9);
  assert.match(queue[0]?.student.fullName ?? '', /Свой/);

  const otherQueue = await listStaffVerifications(otherStaffSession);
  assert.equal(otherQueue.length, 1);
  assert.equal(otherQueue[0]?.id, otherVerificationId, 'очередь ограничена факультетом');

  const adminQueue = await listStaffVerifications(adminSession);
  assert.equal(adminQueue.length, 2);
});

test('фото верификации: свой факультет читает, чужой → ошибка, студент → STAFF_ONLY', async () => {
  const own = await getStaffVerificationPhoto(staffSession, ownVerificationId);
  assert.equal(own.mime, 'image/jpeg');
  assert.ok(own.buffer.byteLength > 0, 'буфер фото отдан');
  assert.ok(!('path' in own), 'путь из БД не отдаётся');

  // Чужой факультет → NOT_OWNER (→ 404).
  await assert.rejects(
    () => getStaffVerificationPhoto(staffSession, otherVerificationId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Студент → STAFF_ONLY.
  await assert.rejects(
    () => getStaffVerificationPhoto(studentSession, ownVerificationId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'STAFF_ONLY',
  );

  // Аудит просмотра фото.
  const audit = await prisma().auditEvent.count({
    where: { entity: 'StudentVerification', entityId: ownVerificationId, action: 'verification.photo_view' },
  });
  assert.equal(audit, 1);
});

test('фото студбилета: файл пропал из хранилища → честная ошибка, а не «проверьте формат»', async () => {
  const photoPath = idCardPhotoRelativePath(ownStudentId, 'card.jpg');
  await rm(join(storageDir, photoPath), { force: true });

  await assert.rejects(
    () => getStaffVerificationPhoto(staffSession, ownVerificationId),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.code === 'NOT_FOUND' &&
      /Фото студбилета не найдено/i.test(error.message),
    'сотрудник видит честную ошибку о пропавшем фото',
  );

  // Ошибка хранилища наверх не уходит: иначе клиент получил бы 400
  // «Файл не принят: проверьте формат (JPEG, PNG или WebP)».
  await assert.rejects(
    () => getStaffVerificationPhoto(staffSession, ownVerificationId),
    (error: unknown) => !(error instanceof Error && error.name === 'IdCardStorageError'),
  );
});

test('решение по верификации: через существующий reviewVerification, чужая → NOT_OWNER', async () => {
  await assert.rejects(
    () => decideStaffVerification(staffSession, otherVerificationId, { status: 'VERIFIED' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Отказ без комментария — ValidationError (правило ядра).
  await assert.rejects(
    () => decideStaffVerification(staffSession, ownVerificationId, { status: 'REJECTED' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );

  const verified = await decideStaffVerification(staffSession, ownVerificationId, { status: 'VERIFIED' });
  assert.equal(verified.status, 'VERIFIED');

  const notification = await prisma().notification.findFirst({
    where: { userId: await studentUserId(ownStudentId), type: 'SYSTEM' },
    orderBy: { createdAt: 'desc' },
  });
  assert.match(notification?.title ?? '', /Верификация пройдена/);
});

// ---------------------------------------------------------------------------
// Уведомления кабинета уходят и в каналы доступа (BRIEF v3, outbox)
// ---------------------------------------------------------------------------

test('решение по заявке, объявление и перенос пары копируются в канал студента', async () => {
  // Студент своего факультета с привязанным Telegram: уведомления должны
  // появиться и на сайте, и в outbox канала.
  const group = await createGroup('КАН-31-1', FACULTY, 3, '01.03.02 Прикладная математика и информатика');
  const student = await createStudent('kanal-student', group.id, { lastName: 'Каналов' });
  const studentUserId = (await prisma().student.findUniqueOrThrow({ where: { id: student.studentId } })).userId;
  await prisma().oAuthAccount.create({
    data: { userId: studentUserId, provider: 'TELEGRAM', providerAccountId: 'tg-kanal' },
  });
  const studentSession = await authSessionFor(studentUserId);
  const today = dateKey(startOfUtcDay(new Date()));

  // 1. Решение сотрудника по заявке.
  const request = await createMyRequest(studentSession, { type: 'REFERENCE', formData: { purpose: 'в банк' } });
  await decideStaffRequest(staffSession, request.id, { status: 'READY' });

  // 2. Объявление деканата для группы.
  await createStaffAnnouncement(staffSession, {
    title: 'Сдача зачётов',
    body: 'Зачёты в среду.',
    audience: 'GROUP',
    groupId: group.id,
  });

  // 3. Перенос пары группы.
  const subject = await createSubject('КАН-101', 'Каналоведение');
  // Преподаватель фикстуры (у него уже есть профиль Teacher).
  const teacherProfile = await prisma().teacher.findFirstOrThrow({
    where: { userId: (await prisma().user.findUniqueOrThrow({ where: { login: 'teacher-staff' } })).id },
    select: { id: true },
  });
  const entryId = await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacherProfile.id,
    date: today,
    startTime: '10:00',
    endTime: '11:20',
  });
  await moveStaffLesson(staffSession, entryId, { date: today, room: 'У-777' });

  // Outbox: три уведомления, по одному на действие, все в его канал.
  const deliveries = await prisma().channelDelivery.findMany({
    where: { userId: studentUserId },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(deliveries.length, 3, 'решение + объявление + перенос пары');
  assert.ok(
    deliveries.every((item) => item.provider === 'TELEGRAM' && item.status === 'PENDING'),
    'записи ждут отправки адаптером канала',
  );

  // Текст доставки = текст уведомления на сайте: канал не выдумывает свой.
  // Ссылка кабинета в outbox дописывается к тексту (модель не хранит её
  // отдельно), поэтому тело доставки НАЧИНАЕТСЯ телом уведомления.
  const notifications = await prisma().notification.findMany({
    where: { userId: studentUserId },
    orderBy: { createdAt: 'asc' },
    select: { title: true, body: true },
  });
  for (const delivery of deliveries) {
    const source = notifications.find(
      (notification) => notification.title === delivery.title && delivery.body.startsWith(notification.body),
    );
    assert.ok(source !== undefined, `доставка «${delivery.title}» повторяет уведомление сайта`);
  }
  assert.deepEqual(
    deliveries.map((item) => item.title),
    ['Заявка готова', 'Объявление деканата: Сдача зачётов', 'Пара перенесена'],
  );
});

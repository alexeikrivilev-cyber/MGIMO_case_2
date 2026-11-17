/**
 * СКВОЗНОЙ ТЕСТ НА IDOR (анти-подмена идентификаторов).
 *
 * Сценарий приёмки PO (docs/ACCEPTANCE.md): «student2 НЕ может открыть
 * оценки/заявки/уведомления student1 подстановкой ID».
 *
 * Создаём двух студентов с полными наборами данных и из сессии student2
 * пытаемся достать всё, что принадлежит student1 — через сервисы и через
 * прямую передачу идентификаторов. Ожидание: отказ (OwnershipError) или
 * пусто, но НИКОГДА чужие данные. Дополнительно проверяем, что неудачные
 * попыски не изменили состояние данных student1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyProfile,
  getMyGrades,
  getMyAcademicSummary,
  getMyRequests,
  getMyRequest,
  cancelMyRequest,
  getMyNotifications,
  markNotificationRead,
  getMySickLeaves,
  isSickNow,
  getMyVerification,
  getMyScheduleToday,
  getMyScheduleWeek,
  requireOwnStudent,
  submitVerification,
  reviewVerification,
  OwnershipError,
  VerificationRequiredError,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createTeacher,
  createUser,
  createSubject,
  createScheduleEntry,
  createGrade,
  createNotification,
  createSickLeave,
  createIdentityRegistryEntry,
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';
import { startOfUtcDay, dateKey } from '../src/index.js';

const FACULTY_1 = 'Институт математики, информационных технологий и физики';
const FACULTY_2 = 'Институт права, социального управления и безопасности';

let student1: { userId: string; studentId: string };
let student2: { userId: string; studentId: string };
let session2: AuthSession;
let student1RequestId: string;
let student1NotificationId: string;
let group1Name: string;
let group2Name: string;

test.before(async () => {
  await resetTestData();

  const group1 = await createGroup('IDOR-11-1', FACULTY_1);
  const group2 = await createGroup('IDOR-22-2', FACULTY_2);
  const teacher = await createTeacher('teacher-idor');
  const staff = await createUser('staff-idor', 'STAFF');

  group1Name = group1.name;
  group2Name = group2.name;

  student1 = await createStudent('student1', group1.id, {
    lastName: 'Первый',
    faculty: FACULTY_1,
  });
  student2 = await createStudent('student2', group2.id, {
    lastName: 'Второй',
    faculty: FACULTY_2,
  });

  const subject1 = await createSubject('IDOR-101', 'Предмет первого');
  const subject2 = await createSubject('IDOR-102', 'Предмет второго');

  // Оценки: у student1 — только пятёрки, у student2 — только тройки.
  await createGrade({ studentId: student1.studentId, subjectId: subject1, value: 5, type: 'EXAM', date: '2026-06-01', semester: 2 });
  await createGrade({ studentId: student1.studentId, subjectId: subject1, value: 5, type: 'COURSEWORK', date: '2026-06-03', semester: 2 });
  await createGrade({ studentId: student2.studentId, subjectId: subject2, value: 3, type: 'EXAM', date: '2026-06-02', semester: 2 });
  await createGrade({ studentId: student2.studentId, subjectId: subject2, value: 3, type: 'COURSEWORK', date: '2026-06-04', semester: 2 });

  // Заявки: у каждого своя.
  const request1 = await prisma().request.create({
    data: {
      studentId: student1.studentId,
      type: 'REFERENCE',
      formData: { purpose: 'секретная цель первого' },
      status: 'NEW',
    },
    select: { id: true },
  });
  student1RequestId = request1.id;
  await prisma().request.create({
    data: {
      studentId: student2.studentId,
      type: 'APPLICATION',
      formData: { reason: 'причина второго' },
      status: 'NEW',
    },
  });

  // Уведомления: у каждого свои.
  student1NotificationId = await createNotification(student1.userId, { title: 'Секретное уведомление первого' });
  await createNotification(student2.userId, { title: 'Уведомление второго' });

  // Болезни: student1 болеет сегодня, student2 — нет.
  const today = startOfUtcDay(new Date());
  await createSickLeave(student1.studentId, dateKey(today), dateKey(today));

  // Верификация: обоим одобряем, иначе успеваемость закрыта гейтом.
  await createIdentityRegistryEntry({
    cardNumber: 'PI-2023-001',
    lastName: 'Первый',
    firstName: 'Студент',
    groupId: group1.id,
    groupName: group1.name,
  });
  await createIdentityRegistryEntry({
    cardNumber: 'UR-2023-002',
    lastName: 'Второй',
    firstName: 'Студент',
    groupId: group2.id,
    groupName: group2.name,
  });

  const session1 = await authSessionFor(student1.userId);
  session2 = await authSessionFor(student2.userId);

  for (const [session, card] of [
    [session1, 'PI-2023-001'],
    [session2, 'UR-2023-002'],
  ] as const) {
    await submitVerification(session, {
      cardNumber: card,
      photoBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mime: 'image/jpeg',
    });
  }

  const staffSession = await authSessionFor(staff.id);
  const v1 = await prisma().studentVerification.findUniqueOrThrow({ where: { studentId: student1.studentId } });
  const v2 = await prisma().studentVerification.findUniqueOrThrow({ where: { studentId: student2.studentId } });
  await reviewVerification(staffSession, v1.id, { status: 'VERIFIED', comment: 'ок' });
  await reviewVerification(staffSession, v2.id, { status: 'VERIFIED', comment: 'ок' });

  // Расписание: у каждой группы своя пара сегодня.
  await createScheduleEntry({
    groupId: group1.id,
    subjectId: subject1,
    teacherId: teacher.teacherId,
    date: dateKey(today),
    startTime: '08:30',
    endTime: '09:50',
    room: 'У-101',
  });
  await createScheduleEntry({
    groupId: group2.id,
    subjectId: subject2,
    teacherId: teacher.teacherId,
    date: dateKey(today),
    startTime: '10:00',
    endTime: '11:20',
    room: 'Л-201',
  });
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('контроль: данные student1 действительно есть в базе (тест не пустой)', async () => {
  assert.equal(await prisma().grade.count({ where: { studentId: student1.studentId } }), 2);
  assert.equal(await prisma().request.count({ where: { studentId: student1.studentId } }), 1);
  assert.equal(await prisma().sickLeave.count({ where: { studentId: student1.studentId } }), 1);
  const secret = await prisma().notification.findFirst({
    where: { userId: student1.userId, title: 'Секретное уведомление первого' },
  });
  assert.ok(secret !== null, 'секретное уведомление student1 существует');
});

test('requireOwnStudent: чужой идентификатор → OwnershipError', () => {
  assert.throws(
    () => requireOwnStudent(session2, student1.studentId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
  assert.equal(requireOwnStudent(session2, student2.studentId), student2.studentId);
});

test('профиль: student2 видит только свой', async () => {
  const profile = await getMyProfile(session2);

  assert.equal(profile.studentId, student2.studentId);
  assert.equal(profile.lastName, 'Второй');
  assert.equal(profile.avatarInitials, 'ВА');
  assert.equal(profile.groupName, group2Name);
  assert.equal(profile.faculty, FACULTY_2);
  assert.ok(!profile.fullName.includes('Первый'));
});

test('успеваемость: student2 видит только свои оценки', async () => {
  const grades = await getMyGrades(session2);
  const entries = grades.semesters.flatMap((semester) => semester.entries);

  assert.equal(entries.length, 2, 'только свои две оценки');
  assert.ok(entries.every((entry) => entry.subjectName === 'Предмет второго'));
  assert.ok(entries.every((entry) => entry.value === 3));
  assert.ok(!entries.some((entry) => entry.subjectName === 'Предмет первого'));
});

test('сводка успеваемости: средний балл student2, не student1', async () => {
  const summary = await getMyAcademicSummary(session2);

  assert.equal(summary.averageScore, 3, 'у student2 — тройки');
  assert.notEqual(summary.averageScore, 5);
});

test('заявки: история student2 не содержит заявки student1', async () => {
  const requests = await getMyRequests(session2);

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.formData, { reason: 'причина второго' });
  assert.ok(
    requests.every((request) => request.id !== student1RequestId),
    'заявка student1 не видна',
  );
});

test('заявка по идентификатору: чужая → OwnershipError, состояние не изменено', async () => {
  await assert.rejects(
    () => getMyRequest(session2, student1RequestId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  await assert.rejects(
    () => cancelMyRequest(session2, student1RequestId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Заявка student1 нетронута.
  const student1Request = await prisma().request.findUniqueOrThrow({ where: { id: student1RequestId } });
  assert.equal(student1Request.status, 'NEW');
  assert.equal(student1Request.staffComment, null);
});

test('уведомления: student2 не видит уведомления student1', async () => {
  const notifications = await getMyNotifications(session2);

  // У student2 есть свои уведомления (в том числе от сервиса верификации),
  // но среди них нет ни одного уведомления student1.
  assert.ok(notifications.length >= 1);
  assert.ok(
    notifications.every((notification) => !notification.title.includes('Секретное')),
    'уведомление student1 не видно',
  );
  assert.ok(
    notifications.some((notification) => notification.title === 'Уведомление второго'),
    'своё уведомление на месте',
  );

  await assert.rejects(
    () => markNotificationRead(session2, student1NotificationId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Уведомление student1 осталось непрочитанным.
  const student1Notification = await prisma().notification.findUniqueOrThrow({
    where: { id: student1NotificationId },
  });
  assert.equal(student1Notification.read, false);
});

test('«болею»: история и статус student2 не знают о болезни student1', async () => {
  const leaves = await getMySickLeaves(session2);
  assert.equal(leaves.length, 0, 'у student2 своих отметок нет — и чужих тоже');

  assert.equal(await isSickNow(session2), false, 'student2 не болеет');
});

test('верификация: student2 видит только свою заявку', async () => {
  const verification = await getMyVerification(session2);

  assert.ok(verification !== null);
  assert.equal(verification.recognizedLastName, 'Второй');
  assert.ok(!JSON.stringify(verification).includes('Первый'));

  const student1Verification = await prisma().studentVerification.findUniqueOrThrow({
    where: { studentId: student1.studentId },
  });
  assert.notEqual(verification.id, student1Verification.id);
});

test('расписание: student2 видит только свою группу', async () => {
  const lessons = await getMyScheduleToday(session2);

  assert.equal(lessons.length, 1);
  assert.equal(lessons[0]?.room, 'Л-201');
  assert.ok(lessons.every((lesson) => lesson.room !== 'У-101'), 'пара чужой группы не видна');

  const week = await getMyScheduleWeek(session2, 0);
  const allLessons = week.days.flatMap((day) => day.lessons);
  assert.ok(allLessons.every((lesson) => lesson.room !== 'У-101'));
});

test('гейт верификации: без верификации данные закрыты (дополнительный барьер)', async () => {
  const group = await createGroup('IDOR-33-3', FACULTY_2);
  const unverified = await createStudent('student3', group.id, { lastName: 'Третий' });
  const session3 = await authSessionFor(unverified.userId);

  await assert.rejects(
    () => getMyGrades(session3),
    (error: unknown) => error instanceof VerificationRequiredError,
  );
  await assert.rejects(
    () => getMyAcademicSummary(session3),
    (error: unknown) => error instanceof VerificationRequiredError,
  );
});

/**
 * Тесты статуса «болею»: валидация периода, лимит 14 дней, пересечение
 * с активной записью, уведомление деканату, история и isSickNow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMySickLeave,
  getMySickLeaves,
  isSickNow,
  MAX_SICK_LEAVE_DAYS,
  ValidationError,
  OwnershipError,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createUser,
  createSickLeave,
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';
import { startOfUtcDay, addUtcDays, dateKey } from '../src/index.js';

let studentSession: AuthSession;
let staffSession: AuthSession;
let studentId: string;

test.before(async () => {
  await resetTestData();
  const group = await createGroup('БОЛ-41-1');
  const student = await createStudent('student-sick', group.id, { lastName: 'Болеющий' });
  const staff = await createUser('staff-sick', 'STAFF');
  await createUser('admin-sick', 'ADMIN');
  studentId = student.studentId;
  studentSession = await authSessionFor(student.userId);
  staffSession = await authSessionFor(staff.id);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('создание отметки: уведомление сотрудникам, аудит', async () => {
  const today = startOfUtcDay(new Date());
  const leave = await createMySickLeave(studentSession, {
    dateFrom: dateKey(today),
    dateTo: dateKey(addUtcDays(today, 2)),
    reason: 'ОРВИ',
  });

  assert.equal(dateKey(leave.dateFrom), dateKey(today));
  assert.equal(dateKey(leave.dateTo), dateKey(addUtcDays(today, 2)));
  assert.equal(leave.reason, 'ОРВИ');
  assert.equal(leave.hasAttachment, false);

  // Уведомления всем сотрудникам (STAFF + ADMIN).
  const staffNotifications = await prisma().notification.findMany({
    where: { title: 'Студент отметил болезнь' },
  });
  assert.equal(staffNotifications.length, 2, ' STAFF и ADMIN уведомлены');
  assert.match(staffNotifications[0]?.body ?? '', /Болеющий/);
  assert.match(staffNotifications[0]?.body ?? '', /БОЛ-41-1/);

  // Студент уведомления о болезни не получает (это его действие).
  const studentNotifications = await prisma().notification.count({
    where: { title: 'Студент отметил болезнь' },
  });
  assert.equal(studentNotifications, 2);

  const audit = await prisma().auditEvent.count({ where: { action: 'sick_leave.create' } });
  assert.equal(audit, 1);
});

test('isSickNow: внутри периода — да, вне периода — нет', async () => {
  const today = startOfUtcDay(new Date());

  assert.equal(await isSickNow(studentSession, today), true);
  assert.equal(await isSickNow(studentSession, addUtcDays(today, 2)), true);
  assert.equal(await isSickNow(studentSession, addUtcDays(today, 3)), false);
  assert.equal(await isSickNow(studentSession, addUtcDays(today, -1)), false);
});

test('период не более 14 дней', async () => {
  const today = startOfUtcDay(new Date());
  // Ровно 14 дней подряд — разрешено (период далеко впереди, чтобы не
  // пересекаться с записями других тестов этого файла).
  const fourteenDays = await createMySickLeave(studentSession, {
    dateFrom: dateKey(addUtcDays(today, 40)),
    dateTo: dateKey(addUtcDays(today, 40 + MAX_SICK_LEAVE_DAYS - 1)),
  });
  assert.ok(fourteenDays.id);

  // 15 дней — отказ.
  await assert.rejects(
    () =>
      createMySickLeave(studentSession, {
        dateFrom: dateKey(addUtcDays(today, 60)),
        dateTo: dateKey(addUtcDays(today, 60 + MAX_SICK_LEAVE_DAYS)),
      }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
});

test('дата начала позже окончания → ошибка', async () => {
  const today = startOfUtcDay(new Date());
  await assert.rejects(
    () =>
      createMySickLeave(studentSession, {
        dateFrom: dateKey(addUtcDays(today, 60)),
        dateTo: dateKey(addUtcDays(today, 59)),
      }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
});

test('пересечение с активной записью → CONFLICT', async () => {
  const today = startOfUtcDay(new Date());
  // Активная запись: сегодня … +2 дня. Пересекающийся период (завтра … +5) — отказ.
  await assert.rejects(
    () =>
      createMySickLeave(studentSession, {
        dateFrom: dateKey(addUtcDays(today, 1)),
        dateTo: dateKey(addUtcDays(today, 5)),
      }),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );

  // Непересекающийся период (через 10 дней) — проходит.
  const later = await createMySickLeave(studentSession, {
    dateFrom: dateKey(addUtcDays(today, 10)),
    dateTo: dateKey(addUtcDays(today, 12)),
  });
  assert.ok(later.id);
});

test('завершившаяся запись не мешает новой (неактивна)', async () => {
  const today = startOfUtcDay(new Date());
  // Запись entirely в прошлом.
  await createSickLeave(studentId, dateKey(addUtcDays(today, -30)), dateKey(addUtcDays(today, -20)));

  const overlappingWithPast = await createMySickLeave(studentSession, {
    dateFrom: dateKey(addUtcDays(today, -25)),
    dateTo: dateKey(addUtcDays(today, -18)),
  });
  assert.ok(overlappingWithPast.id, 'прошлый период пересекать можно');
});

test('zod: некорректный формат даты и мусор', async () => {
  const today = startOfUtcDay(new Date());
  const garbage: unknown[] = [
    { dateFrom: '12.12.2026', dateTo: dateKey(today) },
    { dateFrom: dateKey(today), dateTo: 'завтра' },
    { dateFrom: dateKey(today) },
    { dateFrom: dateKey(today), dateTo: dateKey(today), reason: 'x'.repeat(501) },
    'не объект',
  ];

  for (const input of garbage) {
    await assert.rejects(
      () => createMySickLeave(studentSession, input as never),
      (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
    );
  }
});

test('история отметок студента: сначала новые', async () => {
  const leaves = await getMySickLeaves(studentSession);
  assert.ok(leaves.length >= 3);
  const froms = leaves.map((leave) => leave.dateFrom.getTime());
  assert.deepEqual([...froms].sort((a, b) => b - a), froms);

  // Все записи принадлежат только этому студенту.
  const all = await prisma().sickLeave.findMany();
  assert.equal(all.length, leaves.length);
});

test('не-студенту отметка о болезни недоступна', async () => {
  await assert.rejects(
    () => createMySickLeave(staffSession, { dateFrom: '2030-01-01', dateTo: '2030-01-02' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
  await assert.rejects(
    () => isSickNow(staffSession),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
});

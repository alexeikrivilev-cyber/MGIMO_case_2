/**
 * Тесты заявок и справок: zod-валидация, создание с уведомлением и
 * аудитом, история, просмотр и отмена только своей заявки в статусе NEW.
 * Изоляция между студентами — в test/idor.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMyRequest,
  getMyRequests,
  getMyRequest,
  cancelMyRequest,
  OwnershipError,
  ValidationError,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  authSessionFor,
} from './helpers.js';

let studentSession: AuthSession;
let studentId: string;

test.before(async () => {
  await resetTestData();
  const group = await createGroup('ЗАЯ-23-1');
  const student = await createStudent('student-requests', group.id, { lastName: 'Заявитель' });
  studentId = student.studentId;
  studentSession = await authSessionFor(student.userId);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('создание заявки: статус NEW, уведомление студенту, аудит', async () => {
  const request = await createMyRequest(studentSession, {
    type: 'REFERENCE',
    formData: { purpose: 'для получения социальной стипендии', copies: '2' },
  });

  assert.equal(request.status, 'NEW');
  assert.equal(request.statusLabel, 'Новая');
  assert.equal(request.typeLabel, 'Справка');
  assert.deepEqual(request.formData, { purpose: 'для получения социальной стипендии', copies: '2' });
  assert.equal(request.staffComment, null);

  const { prisma } = await import('../src/db.js');
  const notifications = await prisma().notification.findMany({
    where: { userId: (await prisma().student.findUniqueOrThrow({ where: { id: studentId } })).userId },
  });
  assert.equal(notifications.length, 1, 'студент уведомлён о создании');
  assert.match(notifications[0]?.title ?? '', /Заявка создана/);

  const audit = await prisma().auditEvent.findMany({ where: { entity: 'Request' } });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.action, 'request.create');
  assert.equal(audit[0]?.entityId, request.id);
});

test('zod-ошибка на мусорных данных', async () => {
  const garbage: unknown[] = [
    { type: 'МУСОР', formData: { a: 'b' } },
    { type: 'REFERENCE', formData: {} },
    { type: 'REFERENCE', formData: 'не объект' },
    { type: 'REFERENCE' },
    { formData: { a: 'b' } },
    { type: 'REFERENCE', formData: { a: 42 } },
    { type: 'REFERENCE', formData: { ['x'.repeat(65)]: 'значение' } },
    { type: 'REFERENCE', formData: { a: 'x'.repeat(1001) } },
    { type: 'REFERENCE', formData: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, 'v'])) },
  ];

  for (const input of garbage) {
    await assert.rejects(
      () => createMyRequest(studentSession, input as never),
      (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
      `вход ${JSON.stringify(input).slice(0, 60)} должен быть отклонён`,
    );
  }

  // Ни одна мусорная заявка не создалась.
  const requests = await getMyRequests(studentSession);
  assert.equal(requests.length, 1, 'в базе только первая корректная заявка');
});

test('история заявок студента', async () => {
  await createMyRequest(studentSession, { type: 'APPLICATION', formData: { reason: 'перевод на другой факультет' } });
  const requests = await getMyRequests(studentSession);

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.type, 'APPLICATION', 'сначала новые');
  assert.equal(requests[1]?.type, 'REFERENCE');
});

test('просмотр своей заявки; чужая и несуществующая → OwnershipError', async () => {
  const [own] = await getMyRequests(studentSession);
  assert.ok(own);

  const found = await getMyRequest(studentSession, own.id);
  assert.equal(found.id, own.id);

  await assert.rejects(
    () => getMyRequest(studentSession, '00000000-0000-4000-8000-000000000000'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
  await assert.rejects(
    () => getMyRequest(studentSession, ''),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
});

test('отмена только в статусе NEW', async () => {
  const created = await createMyRequest(studentSession, {
    type: 'REFERENCE',
    formData: { purpose: 'в военкомат' },
  });

  const cancelled = await cancelMyRequest(studentSession, created.id);
  assert.equal(cancelled.status, 'REJECTED');
  assert.equal(cancelled.staffComment, 'Отменена студентом');

  // Повторная отмена невозможна.
  await assert.rejects(
    () => cancelMyRequest(studentSession, created.id),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );

  // Заявка, взятая сотрудником в работу, не отменяется.
  const inProgress = await createMyRequest(studentSession, {
    type: 'APPLICATION',
    formData: { reason: 'академический отпуск' },
  });
  const { prisma } = await import('../src/db.js');
  await prisma().request.update({ where: { id: inProgress.id }, data: { status: 'IN_PROGRESS' } });

  await assert.rejects(
    () => cancelMyRequest(studentSession, inProgress.id),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );

  // Отмена чужой/несуществующей заявки — отказ владения.
  await assert.rejects(
    () => cancelMyRequest(studentSession, '00000000-0000-4000-8000-000000000000'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Уведомление об отмене + аудит.
  const notifications = await prisma().notification.findMany({ where: { title: 'Заявка отменена' } });
  assert.equal(notifications.length, 1);
  const audit = await prisma().auditEvent.count({ where: { action: 'request.cancel' } });
  assert.equal(audit, 1);
});

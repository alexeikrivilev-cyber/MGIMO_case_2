/**
 * СКВОЗНОЙ ТЕСТ НА IDOR ЧЕРЕЗ HTTP (требование ACCEPTANCE):
 * «student2 НЕ может открыть оценки/заявки/уведомления student1
 * подстановкой ID».
 *
 * Сценарий: student2 входит, получает cookie сессии и пытается:
 * - открыть заявку student1 по её идентификатору → 404 (обобщённый
 *   ответ, не отличающийся от «не существует»);
 * - прочитать список заявок → только свои;
 * - прочитать оценки → только свои предметы;
 * - прочитать уведомления → только свои.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as loginRoute } from '../app/api/auth/login/route';
import { GET as requestsRoute, POST as createRequestRoute } from '../app/api/requests/route';
import { GET as requestByIdRoute } from '../app/api/requests/[id]/route';
import { GET as gradesRoute } from '../app/api/grades/route';
import { GET as notificationsRoute } from '../app/api/notifications/route';
import {
  closeWebTestDb,
  createGrade,
  createGroup,
  createNotification,
  createRequest,
  createStudent,
  createSubject,
  createVerification,
  FACULTY_B,
  DIRECTION_B,
  resetWebTestData,
  TEST_PASSWORD,
} from './helpers';
import { apiRequest, callRoute, callRouteWithParams, sessionCookiesFrom } from './http';

let student1RequestId: string;
let student2RequestId: string;

test.before(async () => {
  await resetWebTestData();

  const groupA = await createGroup('ПИ-31');
  const groupB = await createGroup('ЮР-41', FACULTY_B, 1, DIRECTION_B);

  const student1 = await createStudent('student1', groupA.id);
  const student2 = await createStudent('student2', groupB.id, {
    lastName: 'Петрова',
    firstName: 'Мария',
    faculty: FACULTY_B,
    direction: DIRECTION_B,
  });

  // Оба верифицированы: иначе гейт закрыл бы оценки раньше проверки владения.
  await createVerification(student1.studentId, 'VERIFIED');
  await createVerification(student2.studentId, 'VERIFIED');

  const subject1 = await createSubject('T-101', 'Математический анализ');
  const subject2 = await createSubject('T-102', 'Теория государства и права');

  await createGrade(student1.studentId, subject1, 5, null, 'EXAM', 1);
  await createGrade(student2.studentId, subject2, 4, null, 'EXAM', 1);

  student1RequestId = await createRequest(student1.studentId);
  student2RequestId = await createRequest(student2.studentId);

  await createNotification(student1.userId, 'Уведомление студента 1');
  await createNotification(student2.userId, 'Уведомление студента 2');
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test('IDOR: заявка student1 по ID → 404 из сессии student2', async () => {
  const login = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.30.0.1',
      body: { login: 'student2', password: TEST_PASSWORD },
    }),
  );
  assert.equal(login.status(), 200);
  const { session } = sessionCookiesFrom(login.response);
  assert.ok(session !== undefined);

  const foreign = await callRouteWithParams(
    requestByIdRoute,
    apiRequest(`/api/requests/${student1RequestId}`, { cookies: { udgu_session: session } }),
    { id: student1RequestId },
  );
  assert.equal(foreign.status(), 404, 'чужая заявка не отдаётся');
  const body = await foreign.json<{ error: { code: string; message: string } }>();
  assert.equal(body.error.code, 'NOT_FOUND');
  // Ответ не различает «не существует» и «не твоя».
  const nonexistent = await callRouteWithParams(
    requestByIdRoute,
    apiRequest('/api/requests/00000000-0000-0000-0000-000000000000', {
      cookies: { udgu_session: session },
    }),
    { id: '00000000-0000-0000-0000-000000000000' },
  );
  assert.equal(nonexistent.status(), 404);
  assert.equal(
    (await nonexistent.json<{ error: { message: string } }>()).error.message,
    body.error.message,
  );

  // Своя заявка отдаётся.
  const own = await callRouteWithParams(
    requestByIdRoute,
    apiRequest(`/api/requests/${student2RequestId}`, { cookies: { udgu_session: session } }),
    { id: student2RequestId },
  );
  assert.equal(own.status(), 200);
});

test('IDOR: список заявок, оценки и уведомлений — только свои', async () => {
  const login = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.30.0.2',
      body: { login: 'student2', password: TEST_PASSWORD },
    }),
  );
  const { session } = sessionCookiesFrom(login.response);
  assert.ok(session !== undefined);

  const requestsList = await callRoute(
    requestsRoute,
    apiRequest('/api/requests', { cookies: { udgu_session: session } }),
  );
  assert.equal(requestsList.status(), 200);
  const requests = await requestsList.json<{ requests: { id: string }[] }>();
  assert.deepEqual(
    requests.requests.map((item) => item.id),
    [student2RequestId],
    'в списке только заявка student2',
  );

  const grades = await callRoute(
    gradesRoute,
    apiRequest('/api/grades', { cookies: { udgu_session: session } }),
  );
  assert.equal(grades.status(), 200);
  const gradesBody = await grades.json<{
    semesters: { entries: { subjectCode: string }[] }[];
  }>();
  const allCodes = gradesBody.semesters.flatMap((semester) =>
    semester.entries.map((entry) => entry.subjectCode),
  );
  assert.ok(allCodes.length > 0, 'оценки student2 на месте');
  // Set вместо массива: сравнение через .every() сузило бы тип элементов
  // до литерала, и проверка на чужой предмет перестала бы компилироваться.
  const codeSet = new Set<string>(allCodes);
  assert.ok(codeSet.has('T-102'), 'в оценках только предметы student2');
  assert.ok(!codeSet.has('T-101'), 'оценки student1 не протекают');

  const notifications = await callRoute(
    notificationsRoute,
    apiRequest('/api/notifications', { cookies: { udgu_session: session } }),
  );
  assert.equal(notifications.status(), 200);
  const notificationsBody = await notifications.json<{ notifications: { title: string }[] }>();
  const titles = notificationsBody.notifications.map((item) => item.title);
  assert.ok(titles.includes('Уведомление студента 2'), 'своё уведомление на месте');
  assert.ok(!titles.includes('Уведомление студента 1'), 'чужие уведомления не видны');
});

test('IDOR: отметка чужого уведомления прочитанным → 404', async () => {
  const login = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.30.0.3',
      body: { login: 'student2', password: TEST_PASSWORD },
    }),
  );
  const { session } = sessionCookiesFrom(login.response);
  assert.ok(session !== undefined);

  // Уведомление student1: идентификатор берём из БД (в тесте чужим).
  const { getPrisma } = await import('@udgu/db');
  const foreignNotification = await getPrisma().notification.findFirst({
    where: { title: 'Уведомление студента 1' },
    select: { id: true },
  });
  assert.ok(foreignNotification !== null);

  const { POST: markReadRoute } = await import('../app/api/notifications/[id]/read/route');
  const response = await callRouteWithParams(
    markReadRoute,
    apiRequest(`/api/notifications/${foreignNotification.id}/read`, {
      method: 'POST',
      cookies: { udgu_session: session },
    }),
    { id: foreignNotification.id },
  );
  assert.equal(response.status(), 404, 'чужое уведомление недоступно');

  // И оно действительно осталось непрочитанным.
  const stillUnread = await getPrisma().notification.findUnique({
    where: { id: foreignNotification.id },
    select: { read: true },
  });
  assert.equal(stillUnread?.read, false, 'состояние чужих данных не изменилось');
});

test('создание заявки идёт через сессию: владелец — студент из cookie', async () => {
  const login = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.30.0.4',
      body: { login: 'student2', password: TEST_PASSWORD },
    }),
  );
  const { session } = sessionCookiesFrom(login.response);
  assert.ok(session !== undefined);

  const created = await callRoute(
    createRequestRoute,
    apiRequest('/api/requests', {
      method: 'POST',
      cookies: { udgu_session: session },
      body: { type: 'REFERENCE', formData: { purpose: 'Для разряда' } },
    }),
  );
  assert.equal(created.status(), 201);
  const body = await created.json<{ request: { id: string; status: string } }>();
  assert.equal(body.request.status, 'NEW');
});

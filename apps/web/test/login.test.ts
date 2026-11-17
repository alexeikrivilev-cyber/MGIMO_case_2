/**
 * ТЕСТЫ ВХОДА (POST /api/auth/login) — требования ACCEPTANCE:
 * - верные креды → 200 + httpOnly-cookie сессии;
 * - неверный пароль → 401 с ОБЩЕЙ ошибкой (текст не различает «нет такого
 *   логина» и «неверный пароль»);
 * - 6-я попытка подряд → 429 с Retry-After (5/15 мин на логин+IP);
 * - redirectTo по роли: студент → /dashboard, преподаватель →
 *   /teacher/plans, сотрудник деканата → /staff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetLoginRateLimit } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import { POST as loginRoute } from '../app/api/auth/login/route';
import { GET as sessionRoute } from '../app/api/auth/session/route';
import {
  closeWebTestDb,
  createGroup,
  createStudent,
  createTeacher,
  createUser,
  resetWebTestData,
  TEST_PASSWORD,
  FACULTY_A,
} from './helpers';
import { apiRequest, callRoute, sessionCookiesFrom } from './http';

test.before(async () => {
  await resetWebTestData();
  await createGroup('ПИ-31');
  await createStudent('student1', (await getGroupId('ПИ-31')));
  // Преподаватель (STAFF + профиль Teacher) и сотрудник деканата
  // (STAFF + факультет): у них свой раздел после входа.
  await createTeacher('teacher1');
  const staff = await createUser('staff1', 'STAFF');
  await getPrisma().user.update({ where: { id: staff.id }, data: { faculty: FACULTY_A } });
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test.beforeEach(() => {
  // Счётчики rate-limit — в памяти процесса: между тестами сбрасываем,
  // иначе файлы влияли бы друг на друга.
  resetLoginRateLimit();
});

async function getGroupId(name: string): Promise<string> {
  const group = await getPrisma().group.findUnique({ where: { name }, select: { id: true } });
  if (group === null) {
    throw new Error(`Фикстура: группа ${name} не найдена`);
  }
  return group.id;
}

test('верные креды → 200, ok, httpOnly-cookie сессии', async () => {
  const response = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.10.0.1',
      body: { login: 'student1', password: TEST_PASSWORD },
    }),
  );

  assert.equal(response.status(), 200);
  const body = await response.json<{ ok?: boolean; redirectTo?: string }>();
  assert.equal(body.ok, true);
  assert.equal(body.redirectTo, '/dashboard');

  const sessionToken = response.cookie('udgu_session');
  assert.ok(sessionToken !== undefined && sessionToken.length > 20, 'cookie сессии должна быть выставлена');

  const rawSetCookie = response.response.headers.get('set-cookie') ?? '';
  assert.match(rawSetCookie, /udgu_session=/, 'Set-Cookie содержит udgu_session');
  assert.match(rawSetCookie, /HttpOnly/i, 'cookie сессии httpOnly');
  assert.match(rawSetCookie, /SameSite=Lax/i, 'cookie сессии SameSite=Lax');
  // CSRF-cookie выдаётся рядом (паттерн «двойная отправка»).
  assert.match(rawSetCookie, /udgu_csrf=/, 'Set-Cookie содержит udgu_csrf');

  // Сессия рабочая: тот же cookie пускает в /api/auth/session.
  const sessionResponse = await callRoute(
    sessionRoute,
    apiRequest('/api/auth/session', { cookies: { udgu_session: sessionToken } }),
  );
  assert.equal(sessionResponse.status(), 200);
  const sessionBody = await sessionResponse.json<{ user: { login: string; role: string } }>();
  assert.equal(sessionBody.user.login, 'student1');
  assert.equal(sessionBody.user.role, 'STUDENT');
});

test('редирект после входа: студент → /dashboard, преподаватель → /teacher/plans, сотрудник → /staff', async () => {
  const cases: readonly { login: string; redirectTo: string; ip: string }[] = [
    { login: 'student1', redirectTo: '/dashboard', ip: '10.20.0.1' },
    { login: 'teacher1', redirectTo: '/teacher/plans', ip: '10.20.0.2' },
    { login: 'staff1', redirectTo: '/staff', ip: '10.20.0.3' },
  ];

  for (const { login, redirectTo, ip } of cases) {
    const response = await callRoute(
      loginRoute,
      apiRequest('/api/auth/login', {
        method: 'POST',
        ip,
        body: { login, password: TEST_PASSWORD },
      }),
    );
    assert.equal(response.status(), 200, `${login} входит успешно`);
    const body = await response.json<{ ok?: boolean; redirectTo?: string }>();
    assert.equal(body.ok, true);
    assert.equal(body.redirectTo, redirectTo, `${login} → ${redirectTo}`);
  }
});

test('неверный пароль → 401 с общей ошибкой (без намёка на существование логина)', async () => {
  const wrongPassword = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.10.0.2',
      body: { login: 'student1', password: 'wrong-password-999' },
    }),
  );
  assert.equal(wrongPassword.status(), 401);
  const wrongBody = await wrongPassword.json<{ error: { code: string; message: string } }>();
  assert.equal(wrongBody.error.code, 'INVALID_CREDENTIALS');

  const unknownLogin = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.10.0.3',
      body: { login: 'no-such-user-42', password: 'wrong-password-999' },
    }),
  );
  assert.equal(unknownLogin.status(), 401);
  const unknownBody = await unknownLogin.json<{ error: { code: string; message: string } }>();

  // Один и тот же обобщённый ответ в обоих случаях — иначе перебором
  // логинов можно было бы узнавать, кто зарегистрирован.
  assert.equal(unknownBody.error.code, 'INVALID_CREDENTIALS');
  assert.equal(unknownBody.error.message, wrongBody.error.message);
  assert.equal(unknownBody.error.message, 'Неверный логин или пароль.');
  assert.doesNotMatch(unknownBody.error.message, /не существует|не найден|нет такого/i);
});

test('6-я попытка подряд → 429 с Retry-After', async () => {
  const ip = '10.10.0.4';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await callRoute(
      loginRoute,
      apiRequest('/api/auth/login', {
        method: 'POST',
        ip,
        body: { login: 'student1', password: `wrong-${attempt}` },
      }),
    );
    assert.equal(response.status(), 401, `попытка ${attempt} должна получить 401`);
  }

  const blocked = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip,
      body: { login: 'student1', password: TEST_PASSWORD },
    }),
  );
  assert.equal(blocked.status(), 429);
  const retryAfter = blocked.response.headers.get('retry-after');
  assert.ok(retryAfter !== null && Number(retryAfter) > 0, 'Retry-After в секундах');
  const body = await blocked.json<{ error: { code: string } }>();
  assert.equal(body.error.code, 'RATE_LIMITED');

  // Верный пароль тоже заблокирован: лимит висит на паре (логин, IP).
  // С другого IP тот же логин входит — лимит персональный, не глобальный.
  const otherIp = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.10.0.5',
      body: { login: 'student1', password: TEST_PASSWORD },
    }),
  );
  assert.equal(otherIp.status(), 200);
  const { session } = sessionCookiesFrom(otherIp.response);
  assert.ok(session !== undefined);
});

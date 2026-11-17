/**
 * ТЕСТЫ ВЫХОДА (POST /api/auth/logout): отзыв сессии + очистка cookie.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as logoutRoute } from '../app/api/auth/logout/route';
import { GET as sessionRoute } from '../app/api/auth/session/route';
import { POST as loginRoute } from '../app/api/auth/login/route';
import { closeWebTestDb, createGroup, createStudent, resetWebTestData, TEST_PASSWORD } from './helpers';
import { apiRequest, callRoute, sessionCookiesFrom } from './http';

let groupId: string;

test.before(async () => {
  await resetWebTestData();
  const group = await createGroup('ПИ-32');
  groupId = group.id;
  await createStudent('student1', groupId);
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test('logout → cookie очищена, сессия отозвана', async () => {
  const login = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', {
      method: 'POST',
      ip: '10.20.0.1',
      body: { login: 'student1', password: TEST_PASSWORD },
    }),
  );
  assert.equal(login.status(), 200);
  const { session } = sessionCookiesFrom(login.response);
  assert.ok(session !== undefined, 'после входа должна быть cookie сессии');

  const logout = await callRoute(
    logoutRoute,
    apiRequest('/api/auth/logout', { method: 'POST', cookies: { udgu_session: session } }),
  );
  assert.equal(logout.status(), 200);

  const rawSetCookie = logout.response.headers.get('set-cookie') ?? '';
  assert.match(rawSetCookie, /udgu_session=/, 'Set-Cookie удаляет udgu_session');
  assert.match(rawSetCookie, /Max-Age=0/i, 'cookie сессии очищается (Max-Age=0)');

  // Старый токен больше не действует: сессия отозвана в БД.
  const sessionAfter = await callRoute(
    sessionRoute,
    apiRequest('/api/auth/session', { cookies: { udgu_session: session } }),
  );
  assert.equal(sessionAfter.status(), 401);
});

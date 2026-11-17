/**
 * ТЕСТ CSRF (паттерн «двойная отправка»): изменяющий POST к /api/*
 * без заголовка X-CSRF-Token (или с чужим значением) → 403 на уровне
 * middleware; с корректным токеном — запрос доходит до маршрута.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware';
import { NextRequest } from 'next/server';
import { POST as loginRoute } from '../app/api/auth/login/route';
import { POST as createRequestRoute } from '../app/api/requests/route';
import { closeWebTestDb, createGroup, createStudent, resetWebTestData, TEST_PASSWORD } from './helpers';
import { apiRequest, callRoute, responseJson, sessionCookiesFrom } from './http';

test.before(async () => {
  await resetWebTestData();
  const group = await createGroup('ПИ-35');
  await createStudent('student1', group.id);
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

async function loginAndGetCookies(ip: string): Promise<{ session: string; csrf: string }> {
  const response = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', { method: 'POST', ip, body: { login: 'student1', password: TEST_PASSWORD } }),
  );
  assert.equal(response.status(), 200);
  const cookies = sessionCookiesFrom(response.response);
  assert.ok(cookies.session !== undefined && cookies.csrf !== undefined, 'вход выдаёт обе cookie');
  return { session: cookies.session, csrf: cookies.csrf };
}

function postRequest(cookies: { session: string; csrf?: string }, csrfHeader?: string): NextRequest {
  const headers: Record<string, string> = {
    cookie: `udgu_session=${cookies.session}; udgu_csrf=${cookies.csrf ?? ''}`,
    'content-type': 'application/json',
  };
  if (csrfHeader !== undefined) {
    headers['x-csrf-token'] = csrfHeader;
  }
  return new NextRequest('http://localhost/api/requests', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'REFERENCE', formData: { purpose: 'Для разряда' } }),
  });
}

test('POST без CSRF-токена → 403', async () => {
  const cookies = await loginAndGetCookies('10.50.0.1');
  const response = await middleware(postRequest(cookies));
  assert.equal(response.status, 403);
  assert.equal((await responseJson<{ error: { code: string } }>(response)).error.code, 'CSRF_INVALID');
});

test('POST с чужим CSRF-токеном → 403', async () => {
  const cookies = await loginAndGetCookies('10.50.0.2');
  const response = await middleware(postRequest(cookies, 'not-the-real-token'));
  assert.equal(response.status, 403);
});

test('POST с корректным CSRF-токеном проходит middleware и создаёт заявку', async () => {
  const cookies = await loginAndGetCookies('10.50.0.3');

  const middlewareResponse = await middleware(postRequest(cookies, cookies.csrf));
  assert.equal(middlewareResponse.status, 200, 'middleware пропускает запрос');

  // И маршрут реально работает с тем же запросом.
  const routeResponse = await callRoute(
    createRequestRoute,
    apiRequest('/api/requests', {
      method: 'POST',
      cookies: { udgu_session: cookies.session, udgu_csrf: cookies.csrf },
      headers: { 'x-csrf-token': cookies.csrf },
      body: { type: 'REFERENCE', formData: { purpose: 'Для разряда' } },
    }),
  );
  assert.equal(routeResponse.status(), 201);
});

test('GET без CSRF-токена не проверяется (нет изменения состояния)', async () => {
  const cookies = await loginAndGetCookies('10.50.0.4');
  const response = await middleware(
    new NextRequest('http://localhost/api/requests', {
      headers: { cookie: `udgu_session=${cookies.session}; udgu_csrf=${cookies.csrf}` },
    }),
  );
  assert.equal(response.status, 200);
});

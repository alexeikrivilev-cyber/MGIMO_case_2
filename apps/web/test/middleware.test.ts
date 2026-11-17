/**
 * ТЕСТЫ MIDDLEWARE: заголовки безопасности + гейтинг кабинета.
 *
 * - security-заголовки на каждый ответ (CSP строгая, X-Frame-Options,
 *   nosniff, Referrer-Policy, Permissions-Policy);
 * - HSTS НЕ в development и включается в production;
 * - аноним на /api/* → 401; публичные точки (/api/health,
 *   /api/auth/login, /api/auth/oauth/*, /api/auth/csrf) проходят;
 * - аноним на страницу кабинета → редирект на /login;
 * - студент на /staff и /admin → 404 (не 403! требование ACCEPTANCE);
 * - сотрудник деканата на /staff → проходит.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createSession } from '@udgu/core';
import middleware from '../middleware';
import {
  closeWebTestDb,
  createGroup,
  createStudent,
  createUser,
  resetWebTestData,
} from './helpers';
import { responseJson } from './http';

function request(path: string, options: { method?: string; cookies?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (options.cookies !== undefined) {
    headers.cookie = options.cookies;
  }
  return new NextRequest(`http://localhost${path}`, { method: options.method ?? 'GET', headers });
}

let studentSessionCookie: string;
let staffSessionCookie: string;

test.before(async () => {
  await resetWebTestData();
  const group = await createGroup('ПИ-34');
  const student = await createStudent('student1', group.id);
  const staff = await createUser('staff1', 'STAFF');
  // Токены сессий создаём боевым createSession (в БД — только sha256).
  studentSessionCookie = `udgu_session=${(await createSession(student.userId)).token}`;
  staffSessionCookie = `udgu_session=${(await createSession(staff.id)).token}`;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test('security-заголовки на ответе API', async () => {
  const response = await middleware(request('/api/health'));
  assert.equal(response.status, 200);

  const headers = response.headers;
  assert.match(
    headers.get('content-security-policy') ?? '',
    /default-src 'self'/,
    'CSP: default-src self',
  );
  assert.match(headers.get('content-security-policy') ?? '', /script-src 'self' 'unsafe-inline'/);
  assert.match(headers.get('content-security-policy') ?? '', /style-src 'self' 'unsafe-inline'/);
  assert.match(headers.get('content-security-policy') ?? '', /img-src 'self' data: blob:/);
  assert.match(headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  assert.match(headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(headers.get('content-security-policy') ?? '', /base-uri 'self'/);
  assert.match(headers.get('content-security-policy') ?? '', /form-action 'self'/);

  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('permissions-policy'), "camera 'self', microphone 'none', geolocation 'none'");
});

test('HSTS отсутствует в development и включается в production', async () => {
  const dev = await middleware(request('/api/health'));
  assert.equal(dev.headers.get('strict-transport-security'), null, 'в dev HSTS не нужен');

  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    const prod = await middleware(request('/api/health'));
    assert.equal(
      prod.headers.get('strict-transport-security'),
      'max-age=63072000; includeSubDomains; preload',
    );
  } finally {
    env.NODE_ENV = previous;
  }
});

test('заголовки безопасности и на страницах', async () => {
  const response = await middleware(request('/login'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.ok(response.headers.get('content-security-policy') !== null);
});

test('аноним на /api/* → 401; публичные точки проходят', async () => {
  const protectedApi = await middleware(request('/api/grades'));
  assert.equal(protectedApi.status, 401);
  assert.equal((await responseJson<{ error: { code: string } }>(protectedApi)).error.code, 'UNAUTHENTICATED');

  for (const path of ['/api/health', '/api/auth/csrf']) {
    const response = await middleware(request(path));
    assert.equal(response.status, 200, `${path} публичен`);
  }
  const login = await middleware(request('/api/auth/login', { method: 'POST' }));
  assert.equal(login.status, 200, 'вход публичен');
  const oauth = await middleware(request('/api/auth/oauth/vk_id/start', { method: 'POST' }));
  assert.equal(oauth.status, 200, 'OAuth публичен');
});

test('аноним на страницу кабинета → редирект на /login', async () => {
  const response = await middleware(request('/dashboard'));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/login');
});

test('студент на /staff и /admin → 404 (не 403)', async () => {
  for (const path of ['/staff', '/admin', '/staff/requests']) {
    const response = await middleware(request(path, { cookies: studentSessionCookie }));
    assert.equal(response.status, 404, `${path} для студента — 404`);
    assert.notEqual(response.headers.get('location'), '/login', 'без редиректа: раздел «не существует»');
  }
});

test('сотрудник деканата на /staff → проходит', async () => {
  const response = await middleware(request('/staff', { cookies: staffSessionCookie }));
  assert.equal(response.status, 200);
});

test('авторизованный студент проходит в кабинет', async () => {
  const response = await middleware(request('/dashboard', { cookies: studentSessionCookie }));
  assert.equal(response.status, 200);
  const api = await middleware(request('/api/grades', { cookies: studentSessionCookie }));
  assert.equal(api.status, 200);
});

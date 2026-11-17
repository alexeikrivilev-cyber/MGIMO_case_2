/**
 * ТЕСТЫ СЛОЯ СЕССИИ (lib/session.ts): чтение cookie, guard-функции и
 * таблица соответствия ошибок packages/core → HTTP-статусы.
 *
 * Особое внимание — маппингу владения: NOT_OWNER/STAFF_ONLY/
 * FORBIDDEN_ROLE дают 404 (не 403), чтобы ответ не отличал «не твоё»
 * от «не существует».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  OwnershipError,
  ValidationError,
  VerificationRequiredError,
} from '@udgu/core';
import {
  clearSessionCookies,
  coreErrorResponse,
  getSessionFromCookieHeader,
  getSessionFromRequest,
  issueCsrfCookie,
  requireSession,
  requireStaff,
  setSessionCookie,
} from '../lib/session';
import {
  closeWebTestDb,
  createGroup,
  createStudent,
  createUser,
  resetWebTestData,
} from './helpers';
import { responseJson } from './http';

test.before(async () => {
  await resetWebTestData();
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

function requestWithCookie(cookie: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie !== null) {
    headers.cookie = cookie;
  }
  return new NextRequest('http://localhost/api/profile', { headers });
}

test('getSessionFromCookieHeader: нет/мусор/просроченный токен → null', async () => {
  assert.equal(await getSessionFromCookieHeader(null), null);
  assert.equal(await getSessionFromCookieHeader('udgu_session=not-a-token'), null);
  assert.equal(await getSessionFromRequest(requestWithCookie(null)), null);
});

test('requireSession: без cookie → OwnershipError UNAUTHENTICATED (401)', async () => {
  await assert.rejects(
    () => requireSession(requestWithCookie(null)),
    (error: OwnershipError) => {
      assert.equal(error.code, 'UNAUTHENTICATED');
      return true;
    },
  );
});

test('requireSession/requireStaff: с валидной сессией отдают пользователя', async () => {
  const group = await createGroup('ПИ-41');
  const student = await createStudent('student-guard', group.id);
  const staff = await createUser('staff-guard', 'STAFF');
  const studentToken = (await createSession(student.userId)).token;
  const staffToken = (await createSession(staff.id)).token;

  const studentSession = await requireSession(requestWithCookie(`udgu_session=${studentToken}`));
  assert.equal(studentSession.user.login, 'student-guard');
  assert.equal(studentSession.user.studentId, student.studentId);

  const staffUser = await requireStaff(requestWithCookie(`udgu_session=${staffToken}`));
  assert.equal(staffUser.role, 'STAFF');

  // Студент не сотрудник: STAFF_ONLY — на API это 404 (см. маппинг).
  await assert.rejects(
    () => requireStaff(requestWithCookie(`udgu_session=${studentToken}`)),
    (error: OwnershipError) => {
      assert.equal(error.code, 'STAFF_ONLY');
      return true;
    },
  );
});

test('маппинг ошибок: коды владения → 404 с обобщённым сообщением', async () => {
  const notOwner = coreErrorResponse(new OwnershipError('NOT_OWNER', 'Заявка не принадлежит вам.'));
  assert.equal(notOwner.status, 404);
  const notOwnerBody = await responseJson<{ error: { code: string; message: string } }>(notOwner);
  assert.equal(notOwnerBody.error.code, 'NOT_FOUND');
  assert.doesNotMatch(notOwnerBody.error.message, /не принадлежит/i, 'сообщение обобщено');

  for (const code of ['STAFF_ONLY', 'FORBIDDEN_ROLE'] as const) {
    const response = coreErrorResponse(new OwnershipError(code, 'Только для сотрудников.'));
    assert.equal(response.status, 404, `${code} → 404, не 403`);
  }

  const unauthenticated = coreErrorResponse(new OwnershipError('UNAUTHENTICATED', 'Требуется вход.'));
  assert.equal(unauthenticated.status, 401);

  const notAStudent = coreErrorResponse(new OwnershipError('NOT_A_STUDENT', 'Только студенту.'));
  assert.equal(notAStudent.status, 403);
});

test('маппинг ошибок: валидация, конфликт, гейт верификации', async () => {
  const invalid = coreErrorResponse(
    new ValidationError('INVALID_INPUT', 'Некорректные данные заявки.', ['type: укажите тип']),
  );
  assert.equal(invalid.status, 400);
  const invalidBody = await responseJson<{ error: { details?: string[] } }>(invalid);
  assert.deepEqual(invalidBody.error.details, ['type: укажите тип']);

  const conflict = coreErrorResponse(new ValidationError('CONFLICT', 'Период пересекается с активной отметкой.'));
  assert.equal(conflict.status, 409);
  assert.match((await responseJson<{ error: { message: string } }>(conflict)).error.message, /пересекается/);

  const gate = coreErrorResponse(new VerificationRequiredError());
  assert.equal(gate.status, 403);
  const gateBody = await responseJson<{ error: { code: string } }>(gate);
  assert.equal(gateBody.error.code, 'VERIFICATION_REQUIRED');
});

test('маппинг ошибок: неизвестное исключение → 500 без внутренностей', async () => {
  const response = coreErrorResponse(new Error('secret internal detail: postgres://user:pass@host'));
  assert.equal(response.status, 500);
  const text = JSON.stringify(await responseJson(response));
  assert.doesNotMatch(text, /postgres|secret/i, 'детали внутренней ошибки не утекают');
});

test('cookie-хелперы: сессия ставится и очищается, CSRF выдаётся', async () => {
  const group = await createGroup('ПИ-42');
  const student = await createStudent('student-cookie', group.id);
  const { token } = await createSession(student.userId);

  const response = new NextResponse();
  setSessionCookie(response, token);
  const csrfToken = issueCsrfCookie(response);
  assert.ok(csrfToken.length > 20);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  assert.ok(setCookies.some((cookie) => cookie.startsWith('udgu_session=') && cookie.includes('HttpOnly')));
  assert.ok(setCookies.some((cookie) => cookie.startsWith('udgu_csrf=') && !cookie.includes('HttpOnly')));

  const cleared = clearSessionCookies(new NextResponse());
  const clearedCookies = cleared.headers.getSetCookie?.() ?? [];
  assert.ok(clearedCookies.some((cookie) => cookie.startsWith('udgu_session=') && cookie.includes('Max-Age=0')));
  assert.ok(clearedCookies.some((cookie) => cookie.startsWith('udgu_csrf=') && cookie.includes('Max-Age=0')));
});

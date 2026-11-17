/**
 * ТЕСТ ГЕЙТА ВЕРИФИКАЦИИ (BRIEF v2, ACCEPTANCE): до верификации
 * студбилета успеваемость закрыта — ответ 403 с кодом
 * VERIFICATION_REQUIRED; после верификации раздел открывается.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as loginRoute } from '../app/api/auth/login/route';
import { GET as sessionRoute } from '../app/api/auth/session/route';
import { GET as gradesRoute } from '../app/api/grades/route';
import { GET as gradesSummaryRoute } from '../app/api/grades/summary/route';
import { GET as profileRoute } from '../app/api/profile/route';
import {
  closeWebTestDb,
  createGrade,
  createGroup,
  createStudent,
  createSubject,
  createVerification,
  resetWebTestData,
  TEST_PASSWORD,
} from './helpers';
import { apiRequest, callRoute, sessionCookiesFrom } from './http';

test.before(async () => {
  await resetWebTestData();
  const group = await createGroup('ПИ-33');

  const verified = await createStudent('student1', group.id);
  const unverified = await createStudent('student2', group.id, {
    lastName: 'Петрова',
    firstName: 'Мария',
  });
  await createVerification(verified.studentId, 'VERIFIED');

  const subject = await createSubject('T-201', 'Базы данных');
  await createGrade(verified.studentId, subject, 5, null, 'EXAM', 1);
  await createGrade(unverified.studentId, subject, 3, null, 'EXAM', 1);
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

async function login(login: string, ip: string): Promise<string> {
  const response = await callRoute(
    loginRoute,
    apiRequest('/api/auth/login', { method: 'POST', ip, body: { login, password: TEST_PASSWORD } }),
  );
  assert.equal(response.status(), 200);
  const { session } = sessionCookiesFrom(response.response);
  assert.ok(session !== undefined);
  return session;
}

test('неверифицированный студент: /api/grades → 403 VERIFICATION_REQUIRED', async () => {
  const session = await login('student2', '10.40.0.1');

  const grades = await callRoute(
    gradesRoute,
    apiRequest('/api/grades', { cookies: { udgu_session: session } }),
  );
  assert.equal(grades.status(), 403);
  const body = await grades.json<{ error: { code: string; message: string } }>();
  assert.equal(body.error.code, 'VERIFICATION_REQUIRED');

  const summary = await callRoute(
    gradesSummaryRoute,
    apiRequest('/api/grades/summary', { cookies: { udgu_session: session } }),
  );
  assert.equal(summary.status(), 403);
  assert.equal((await summary.json<{ error: { code: string } }>()).error.code, 'VERIFICATION_REQUIRED');

  // А вот профиль и гейт доступны всегда (BRIEF v2): студент видит,
  // что закрыто и почему.
  const profile = await callRoute(
    profileRoute,
    apiRequest('/api/profile', { cookies: { udgu_session: session } }),
  );
  assert.equal(profile.status(), 200);

  const sessionResponse = await callRoute(
    sessionRoute,
    apiRequest('/api/auth/session', { cookies: { udgu_session: session } }),
  );
  const gate = await sessionResponse.json<{
    verificationGate: { verified: boolean; locked: readonly string[] };
  }>();
  assert.equal(gate.verificationGate.verified, false);
  assert.ok(gate.verificationGate.locked.includes('grades'), 'оценки в закрытых разделах');
});

test('верифицированный студент: /api/grades → 200', async () => {
  const session = await login('student1', '10.40.0.2');

  const grades = await callRoute(
    gradesRoute,
    apiRequest('/api/grades', { cookies: { udgu_session: session } }),
  );
  assert.equal(grades.status(), 200);
  const body = await grades.json<{ semesters: { entries: { value: number | null }[] }[] }>();
  const values = body.semesters.flatMap((semester) => semester.entries.map((entry) => entry.value));
  assert.deepEqual(values, [5], 'оценки верифицированного студента на месте');
});

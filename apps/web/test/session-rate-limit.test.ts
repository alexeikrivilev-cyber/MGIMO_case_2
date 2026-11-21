/**
 * HTTP-ТЕСТЫ ЛИМИТЕРА ДЕЙСТВИЙ КАБИНЕТА (ARCHITECTURE §4):
 * 30 POST-действий за минуту на пару (раздел-bucket, пользователь
 * сессии). Счётчики — in-memory скользящее окно packages/core
 * (ratelimit.ts), сбрасывается в helpers перед каждым файлом тестов.
 *
 * Проверяем ровно то, что обещает спека:
 * - 30 быстрых POST проходят, 31-й → 429 с кодом RATE_LIMITED,
 *   русским сообщением и заголовком Retry-After (> 0);
 * - лимитер разных bucket'ов независим: заблокированный ассистент
 *   не мешает заявкам, отметкам о болезни, диалогам и ассистенту
 *   преподавателя;
 * - GET-ы лимитером не трогаются.
 *
 * Роуты вызываются напрямую (test/http.ts) — тот же код, что в проде.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, dateKey } from '@udgu/core';
import { POST as assistantRoute } from '../app/api/assistant/route';
import { POST as teacherAssistantRoute } from '../app/api/teacher/assistant/route';
import { POST as createConversationRoute } from '../app/api/conversations/route';
import { POST as createRequestRoute } from '../app/api/requests/route';
import { GET as requestsRoute } from '../app/api/requests/route';
import { POST as sickLeaveRoute } from '../app/api/sick-leave/route';
import {
  closeWebTestDb,
  createGroup,
  createStudent,
  createTeacher,
  createVerification,
  resetWebTestData,
} from './helpers';
import { apiRequest, callRoute } from './http';

/** Сколько действий разрешено в окне (константа packages/core). */
const MAX_ACTIONS = 30;

let studentToken: string;
let teacherToken: string;
let teacherId: string;

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('РЛ-11');
  const teacher = await createTeacher('rate-limit-teacher');
  const student = await createStudent('rate-limit-student', group.id);
  await createVerification(student.studentId, 'VERIFIED');

  teacherId = teacher.teacherId;
  studentToken = (await createSession(student.userId)).token;
  teacherToken = (await createSession(teacher.userId)).token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test('лимитер: 30 быстрых POST проходят, 31-й → 429 RATE_LIMITED + Retry-After', async () => {
  for (let action = 0; action < MAX_ACTIONS; action += 1) {
    const response = await callRoute(
      assistantRoute,
      apiRequest('/api/assistant', {
        method: 'POST',
        body: { question: 'привет' },
        cookies: { udgu_session: studentToken },
      }),
    );
    assert.equal(response.status(), 200, `действие ${action + 1} из ${MAX_ACTIONS} разрешено`);
  }

  const blocked = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'привет' },
      cookies: { udgu_session: studentToken },
    }),
  );
  assert.equal(blocked.status(), 429);
  const body = await blocked.json<{ error: { code: string; message: string } }>();
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.match(body.error.message, /Слишком часто/);
  const retryAfter = Number(blocked.response.headers.get('retry-after'));
  assert.ok(retryAfter > 0, `Retry-After в секундах (${retryAfter})`);
});

test('лимитер: разделы-bucket независимы — заблокированный ассистент не мешает остальным разделам', async () => {
  // Ассистент студента для этого пользователя уже заблокирован
  // предыдущим тестом (in-memory счётчики живут в процессе файла).
  const stillBlocked = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'привет' },
      cookies: { udgu_session: studentToken },
    }),
  );
  assert.equal(stillBlocked.status(), 429, 'блокировка держится до конца окна');

  // Заявки (bucket 'requests').
  const request = await callRoute(
    createRequestRoute,
    apiRequest('/api/requests', {
      method: 'POST',
      body: { type: 'REFERENCE', formData: { purpose: 'По месту требования' } },
      cookies: { udgu_session: studentToken },
    }),
  );
  assert.equal(request.status(), 201, 'заявка создаётся: лимит считается по своему bucket');

  // Отметка о болезни (bucket 'sick-leave').
  const form = new FormData();
  form.set('dateFrom', dateKey(new Date()));
  form.set('dateTo', dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const sickLeave = await callRoute(
    sickLeaveRoute,
    apiRequest('/api/sick-leave', {
      method: 'POST',
      formData: form,
      cookies: { udgu_session: studentToken },
    }),
  );
  assert.equal(sickLeave.status(), 201, 'отметка о болезни создаётся: свой bucket');

  // Диалог с преподавателем (bucket 'messages').
  const conversation = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', {
      method: 'POST',
      body: { teacherId },
      cookies: { udgu_session: studentToken },
    }),
  );
  assert.equal(conversation.status(), 201, 'диалог открывается: свой bucket');

  // Ассистент преподавателя (bucket 'teacher-assistant', другая сессия).
  const teacherAssistant = await callRoute(
    teacherAssistantRoute,
    apiRequest('/api/teacher/assistant', {
      method: 'POST',
      body: { question: 'Что по лабораторным?' },
      cookies: { udgu_session: teacherToken },
    }),
  );
  assert.equal(teacherAssistant.status(), 200, 'ассистент преподавателя отвечает: свой bucket');

  // GET-ы лимитер не трогают: список заявок открыт, хотя POST заблокирован.
  const list = await callRoute(
    requestsRoute,
    apiRequest('/api/requests', { cookies: { udgu_session: studentToken } }),
  );
  assert.equal(list.status(), 200);
});

/**
 * HTTP-ТЕСТЫ ПЕРЕПИСКИ (/api/conversations/*).
 *
 * Проверяем ровно то, что проверяет PO (BRIEF v2 §4, ACCEPTANCE):
 *   - студент видит свои диалоги, преподаватель — диалоги, где пишут ему,
 *     и в каждом видит ФИО и ГРУППУ автора;
 *   - неверифицированный студент → 403 VERIFICATION_REQUIRED (переписка
 *     закрыта до сверки студбилета — гейт на сервере, не только в UI);
 *   - чужой диалог по conversationId → 404 (анти-IDOR: student2 не
 *     открывает переписку student1);
 *   - отправка создаёт сообщение и уведомление получателю;
 *   - отметка о прочтении возвращает количество отмеченных сообщений;
 *   - middleware не открывает /api/conversations/* анонимам (401).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createSession } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import {
  GET as conversationsRoute,
  POST as createConversationRoute,
} from '../app/api/conversations/route';
import { GET as conversationRoute } from '../app/api/conversations/[id]/route';
import { POST as sendMessageRoute } from '../app/api/conversations/[id]/messages/route';
import { POST as markReadRoute } from '../app/api/conversations/[id]/read/route';
import middleware from '../middleware';
import {
  closeWebTestDb,
  createGroup,
  createStudent,
  createTeacher,
  createUser,
  createVerification,
  resetWebTestData,
} from './helpers';
import { apiRequest, callRoute, callRouteWithParams } from './http';

let studentToken: string;
let unverifiedToken: string;
let otherStudentToken: string;
let teacherToken: string;
let teacherId: string;
let ownConversationId: string;
let otherConversationId: string;
let studentUserId: string;
let teacherUserId: string;

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('ПИ-36');
  const student = await createStudent('student1', group.id, { lastName: 'Иванов', firstName: 'Александр' });
  const unverified = await createStudent('student2', group.id, { lastName: 'Петрова', firstName: 'Мария' });
  const other = await createStudent('student3', group.id, { lastName: 'Сидоров', firstName: 'Пётр' });
  const teacher = await createTeacher('teacher1');
  teacherId = teacher.teacherId;
  studentUserId = student.userId;
  teacherUserId = teacher.userId;

  await createVerification(student.studentId, 'VERIFIED');
  await createVerification(other.studentId, 'VERIFIED');
  await createVerification(unverified.studentId, 'PENDING');

  // Диалог student1 ↔ teacher1 с одним непрочитанным ответом преподавателя.
  const own = await getPrisma().conversation.create({
    data: { studentId: student.studentId, teacherId: teacher.teacherId },
    select: { id: true },
  });
  ownConversationId = own.id;
  await getPrisma().message.create({
    data: { conversationId: own.id, authorUserId: student.userId, body: 'Вопрос по курсовой', readAt: new Date() },
  });
  await getPrisma().message.create({
    data: { conversationId: own.id, authorUserId: teacher.userId, body: 'Приходите в часы приёма', readAt: null },
  });

  // Диалог student3 ↔ teacher1: student1 не должен его видеть.
  const otherConversation = await getPrisma().conversation.create({
    data: { studentId: other.studentId, teacherId: teacher.teacherId },
    select: { id: true },
  });
  otherConversationId = otherConversation.id;
  await getPrisma().message.create({
    data: { conversationId: otherConversation.id, authorUserId: other.userId, body: 'Чужая переписка', readAt: null },
  });

  studentToken = (await createSession(student.userId)).token;
  unverifiedToken = (await createSession(unverified.userId)).token;
  otherStudentToken = (await createSession(other.userId)).token;
  teacherToken = (await createSession(teacher.userId)).token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

// ---------------------------------------------------------------------------
// Список диалогов
// ---------------------------------------------------------------------------

test('GET /api/conversations: студент — свои диалоги, преподаватель — с ФИО и группой', async () => {
  const studentResponse = await callRoute(
    conversationsRoute,
    apiRequest('/api/conversations', { cookies: { udgu_session: studentToken } }),
  );
  assert.equal(studentResponse.status(), 200);
  const studentBody = await studentResponse.json<{
    conversations: { id: string; peer: { fullName: string }; unreadCount: number }[];
  }>();
  assert.equal(studentBody.conversations.length, 1);
  assert.equal(studentBody.conversations[0]?.id, ownConversationId);
  assert.match(studentBody.conversations[0]?.peer.fullName ?? '', /Преподавательская/);
  assert.equal(studentBody.conversations[0]?.unreadCount, 1);

  // Преподаватель видит обоих студентов, каждый — с ФИО и группой.
  const teacherResponse = await callRoute(
    conversationsRoute,
    apiRequest('/api/conversations', { cookies: { udgu_session: teacherToken } }),
  );
  assert.equal(teacherResponse.status(), 200);
  const teacherBody = await teacherResponse.json<{
    conversations: { peer: { fullName: string; groupName: string | null } }[];
  }>();
  assert.equal(teacherBody.conversations.length, 2);
  for (const conversation of teacherBody.conversations) {
    assert.match(conversation.peer.fullName ?? '', /Иванов|Сидоров/, 'ФИО автора видно преподавателю');
    assert.equal(conversation.peer.groupName, 'ПИ-36', 'группа автора видна преподавателю');
  }
});

test('GET /api/conversations: неверифицированный студент → 403 VERIFICATION_REQUIRED', async () => {
  const response = await callRoute(
    conversationsRoute,
    apiRequest('/api/conversations', { cookies: { udgu_session: unverifiedToken } }),
  );
  assert.equal(response.status(), 403);
  const body = await response.json<{ error: { code: string } }>();
  assert.equal(body.error.code, 'VERIFICATION_REQUIRED');
});

test('middleware: /api/conversations закрыт для анонима (401)', async () => {
  const response = await middleware(new NextRequest('http://localhost/api/conversations'));
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// Начало диалога
// ---------------------------------------------------------------------------

test('POST /api/conversations: существующий диалог открывается заново, а не дублируется', async () => {
  const first = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', { method: 'POST', cookies: { udgu_session: studentToken }, body: { teacherId } }),
  );
  assert.equal(first.status(), 201);
  const firstBody = await first.json<{ conversation: { id: string; messages: unknown[] } }>();
  assert.equal(firstBody.conversation.id, ownConversationId, 'диалог с этим преподавателем уже был');
  assert.equal(firstBody.conversation.messages.length, 2, 'история переписки сохранена');

  const second = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', { method: 'POST', cookies: { udgu_session: studentToken }, body: { teacherId } }),
  );
  assert.equal(second.status(), 201);
  const secondBody = await second.json<{ conversation: { id: string } }>();
  assert.equal(secondBody.conversation.id, firstBody.conversation.id, 'диалог с тем же преподавателем не дублируется');

  const list = await callRoute(
    conversationsRoute,
    apiRequest('/api/conversations', { cookies: { udgu_session: studentToken } }),
  );
  const listBody = await list.json<{ conversations: { id: string }[] }>();
  assert.equal(listBody.conversations.length, 1, 'в списке по-прежнему один диалог');

  // Неизвестный преподаватель → 404 (как «не найдено», без подсказок перебором).
  const unknown = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', {
      method: 'POST',
      cookies: { udgu_session: studentToken },
      body: { teacherId: '00000000-0000-4000-8000-000000000000' },
    }),
  );
  assert.equal(unknown.status(), 404);

  // Пустое тело → 400 (zod на границе).
  const empty = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', { method: 'POST', cookies: { udgu_session: studentToken }, body: {} }),
  );
  assert.equal(empty.status(), 400);
});

test('POST /api/conversations: неверифицированный студент и преподаватель не создают диалог', async () => {
  const unverified = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', { method: 'POST', cookies: { udgu_session: unverifiedToken }, body: { teacherId } }),
  );
  assert.equal(unverified.status(), 403);

  const byTeacher = await callRoute(
    createConversationRoute,
    apiRequest('/api/conversations', { method: 'POST', cookies: { udgu_session: teacherToken }, body: { teacherId } }),
  );
  assert.equal(byTeacher.status(), 403, 'инициатива диалога принадлежит студенту');
});

// ---------------------------------------------------------------------------
// Диалог, сообщения, чтение
// ---------------------------------------------------------------------------

test('GET /api/conversations/[id]: свой диалог — 200, чужой — 404 (анти-IDOR)', async () => {
  const own = await callRouteWithParams(
    conversationRoute,
    apiRequest(`/api/conversations/${ownConversationId}`, { cookies: { udgu_session: studentToken } }),
    { id: ownConversationId },
  );
  assert.equal(own.status(), 200);
  const ownBody = await own.json<{ conversation: { messages: { body: string; mine: boolean }[] } }>();
  assert.equal(ownBody.conversation.messages.length, 2);
  assert.equal(ownBody.conversation.messages[0]?.mine, true);

  const foreign = await callRouteWithParams(
    conversationRoute,
    apiRequest(`/api/conversations/${otherConversationId}`, { cookies: { udgu_session: studentToken } }),
    { id: otherConversationId },
  );
  assert.equal(foreign.status(), 404, 'чужой диалог не отличается от несуществующего');
  const foreignBody = await foreign.json<{ error: { code: string } }>();
  assert.equal(foreignBody.error.code, 'NOT_FOUND');
});

test('POST messages: сообщение создаётся, получатель уведомлён; пустое тело — 400', async () => {
  const empty = await callRouteWithParams(
    sendMessageRoute,
    apiRequest(`/api/conversations/${ownConversationId}/messages`, {
      method: 'POST',
      cookies: { udgu_session: studentToken },
      body: { body: '   ' },
    }),
    { id: ownConversationId },
  );
  assert.equal(empty.status(), 400);

  const sent = await callRouteWithParams(
    sendMessageRoute,
    apiRequest(`/api/conversations/${ownConversationId}/messages`, {
      method: 'POST',
      cookies: { udgu_session: studentToken },
      body: { body: 'Хорошо, приду' },
    }),
    { id: ownConversationId },
  );
  assert.equal(sent.status(), 201);

  const notifications = await getPrisma().notification.findMany({
    where: { userId: teacherUserId, type: 'MESSAGE' },
  });
  assert.ok(notifications.length >= 1, 'преподаватель получил уведомление о сообщении');

  // Чужой диалог → 404.
  const foreign = await callRouteWithParams(
    sendMessageRoute,
    apiRequest(`/api/conversations/${otherConversationId}/messages`, {
      method: 'POST',
      cookies: { udgu_session: studentToken },
      body: { body: 'Чужой диалог' },
    }),
    { id: otherConversationId },
  );
  assert.equal(foreign.status(), 404);
});

test('POST read: отмечает сообщения другого автора, чужой диалог — 404', async () => {
  const read = await callRouteWithParams(
    markReadRoute,
    apiRequest(`/api/conversations/${ownConversationId}/read`, {
      method: 'POST',
      cookies: { udgu_session: teacherToken },
      body: {},
    }),
    { id: ownConversationId },
  );
  assert.equal(read.status(), 200);
  const readBody = await read.json<{ ok: boolean; updated: number }>();
  assert.equal(readBody.ok, true);
  assert.equal(readBody.updated, 1, 'непрочитанным было одно сообщение студента');

  const detail = await callRouteWithParams(
    conversationRoute,
    apiRequest(`/api/conversations/${ownConversationId}`, { cookies: { udgu_session: teacherToken } }),
    { id: ownConversationId },
  );
  const detailBody = await detail.json<{ conversation: { unreadCount: number } }>();
  assert.equal(detailBody.conversation.unreadCount, 0);

  const foreign = await callRouteWithParams(
    markReadRoute,
    apiRequest(`/api/conversations/${otherConversationId}/read`, {
      method: 'POST',
      cookies: { udgu_session: studentToken },
      body: {},
    }),
    { id: otherConversationId },
  );
  assert.equal(foreign.status(), 404);
});

test('диалоги студента разделены: student3 не видит диалог student1', async () => {
  const list = await callRoute(
    conversationsRoute,
    apiRequest('/api/conversations', { cookies: { udgu_session: otherStudentToken } }),
  );
  const body = await list.json<{ conversations: { id: string }[] }>();
  assert.equal(body.conversations.length, 1);
  assert.equal(body.conversations[0]?.id, otherConversationId);

  const foreign = await callRouteWithParams(
    conversationRoute,
    apiRequest(`/api/conversations/${ownConversationId}`, { cookies: { udgu_session: otherStudentToken } }),
    { id: ownConversationId },
  );
  assert.equal(foreign.status(), 404);
  assert.ok(studentUserId.length > 0, 'фикстура студента использована');
});

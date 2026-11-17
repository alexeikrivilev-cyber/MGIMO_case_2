/**
 * HTTP-ТЕСТЫ КАБИНЕТА СОТРУДНИКА ДЕКАНАТА (/api/staff/*).
 *
 * Проверяем ровно то, что проверяет PO (ACCEPTANCE, BRIEF §2):
 *   - студент на /api/staff/* → 404 (не 403! раздел «не существует»);
 *   - преподаватель (STAFF без faculty) → 404;
 *   - сотрудник видит ТОЛЬКО свой факультет, ADMIN — все;
 *   - decide меняет статус и создаёт уведомление студенту;
 *   - photo-stream отдаёт image/* с Cache-Control: no-store;
 *   - middleware не открыл /api/staff/* анонимам (401 без сессии).
 *
 * Роуты вызываются напрямую (как data-routes.test.ts): это тот же код,
 * что в продакшене. CSRF-гейт middleware проверяется отдельным тестом.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { createSession } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import { GET as notificationsRoute } from '../app/api/notifications/route';
import { GET as dashboardRoute } from '../app/api/staff/dashboard/route';
import { GET as staffRequestsRoute } from '../app/api/staff/requests/route';
import { POST as decideRequestRoute } from '../app/api/staff/requests/[id]/decide/route';
import {
  GET as staffAnnouncementsRoute,
  POST as createAnnouncementRoute,
} from '../app/api/staff/announcements/route';
import { GET as staffScheduleRoute } from '../app/api/staff/schedule/route';
import { POST as moveLessonRoute } from '../app/api/staff/schedule/[id]/move/route';
import { POST as cancelLessonRoute } from '../app/api/staff/schedule/[id]/cancel/route';
import { GET as staffSickLeavesRoute } from '../app/api/staff/sick-leaves/route';
import { GET as staffVerificationsRoute } from '../app/api/staff/verifications/route';
import { GET as verificationPhotoRoute } from '../app/api/staff/verifications/[id]/photo/route';
import middleware from '../middleware';
import {
  closeWebTestDb,
  createGroup,
  createRequest,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createUser,
  createVerification,
  resetWebTestData,
  utcDay,
  FACULTY_A,
  FACULTY_B,
} from './helpers';
import { apiRequest, callRoute, callRouteWithParams } from './http';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

let studentToken: string;
let teacherToken: string;
let staffToken: string;
let adminToken: string;
let ownRequestId: string;
let otherRequestId: string;
let ownEntryId: string;
let otherEntryId: string;
let ownGroupId: string;
let otherGroupId: string;
let ownVerificationId: string;

function staffCookies(): { udgu_session: string } {
  return { udgu_session: staffToken };
}

test.before(async () => {
  await resetWebTestData();

  const ownGroup = await createGroup('ПИ-33', FACULTY_A);
  const otherGroup = await createGroup('ЮР-31', FACULTY_B, 3, '40.03.01 Юриспруденция');
  ownGroupId = ownGroup.id;
  otherGroupId = otherGroup.id;

  const ownStudent = await createStudent('student1', ownGroup.id, { faculty: FACULTY_A });
  const otherStudent = await createStudent('student2', otherGroup.id, { faculty: FACULTY_B });

  // Сотрудник деканата своего факультета, админ, преподаватель (STAFF без faculty).
  const staff = await createUser('staff1', 'STAFF');
  const admin = await createUser('admin1', 'ADMIN');
  const teacher = await createTeacher('teacher1');
  // Привязка сотрудника к факультету — как в сидере (users.faculty).
  await getPrisma().user.update({ where: { id: staff.id }, data: { faculty: FACULTY_A } });

  // Заявки двух факультетов.
  ownRequestId = await createRequest(ownStudent.studentId, 'NEW');
  otherRequestId = await createRequest(otherStudent.studentId, 'NEW');

  // Расписание двух факультетов.
  const subject = await createSubject('T-900', 'Тестовый предмет');
  const today = utcDay(new Date().toISOString().slice(0, 10));
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  ownEntryId = await createScheduleEntry({
    groupId: ownGroup.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: today.toISOString().slice(0, 10),
    startTime: '10:00',
    endTime: '11:20',
  });
  otherEntryId = await createScheduleEntry({
    groupId: otherGroup.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: tomorrow.toISOString().slice(0, 10),
    startTime: '10:00',
    endTime: '11:20',
  });

  // Верификация своего студента + файл фото во временном хранилище.
  await createVerification(ownStudent.studentId, 'PENDING');
  const verification = await getPrisma().studentVerification.findUniqueOrThrow({
    where: { studentId: ownStudent.studentId },
    select: { id: true },
  });
  ownVerificationId = verification.id;
  const storageDir = process.env.STORAGE_DIR as string;
  await mkdir(join(storageDir, 'id-cards', ownStudent.studentId), { recursive: true });
  await writeFile(join(storageDir, 'id-cards', ownStudent.studentId, 'fixture.jpg'), JPEG);

  studentToken = (await createSession(ownStudent.userId)).token;
  teacherToken = (await createSession(teacher.userId)).token;
  staffToken = (await createSession(staff.id)).token;
  adminToken = (await createSession(admin.id)).token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

// ---------------------------------------------------------------------------
// Гейт доступа: 404 (не 403) для «не своих»
// ---------------------------------------------------------------------------

test('GET /api/staff/dashboard: студент и преподаватель → 404, сотрудник → 200', async () => {
  for (const [token, label] of [
    [studentToken, 'студент'],
    [teacherToken, 'преподаватель'],
  ] as const) {
    const response = await callRoute(
      dashboardRoute,
      apiRequest('/api/staff/dashboard', { cookies: { udgu_session: token } }),
    );
    assert.equal(response.status(), 404, `${label} не должен проходить в кабинет деканата (404, не 403)`);
    const body = await response.json<{ error: { code: string } }>();
    assert.equal(body.error.code, 'NOT_FOUND', 'ответ не раскрывает существование раздела');
  }

  const staffResponse = await callRoute(
    dashboardRoute,
    apiRequest('/api/staff/dashboard', { cookies: staffCookies() }),
  );
  assert.equal(staffResponse.status(), 200);
  const staffBody = await staffResponse.json<{
    dashboard: { faculty: string; newRequests: number };
  }>();
  assert.equal(staffBody.dashboard.faculty, FACULTY_A);
  assert.equal(staffBody.dashboard.newRequests, 1, 'только заявки своего факультета');

  const adminResponse = await callRoute(
    dashboardRoute,
    apiRequest('/api/staff/dashboard', { cookies: { udgu_session: adminToken } }),
  );
  assert.equal(adminResponse.status(), 200);
  const adminBody = await adminResponse.json<{ dashboard: { faculty: string | null; newRequests: number } }>();
  assert.equal(adminBody.dashboard.faculty, null, 'админ видит все факультеты');
  assert.equal(adminBody.dashboard.newRequests, 2);
});

test('middleware: /api/staff/* не публичен — аноним получает 401', async () => {
  const response = await middleware(new NextRequest('http://localhost/api/staff/dashboard'));
  assert.equal(response.status, 401, 'без сессии /api/staff/* закрыт (как и весь /api/*)');
});

// ---------------------------------------------------------------------------
// Заявки: очередь и решение
// ---------------------------------------------------------------------------

test('GET /api/staff/requests: сотрудник — только свой факультет, админ — все', async () => {
  const staffResponse = await callRoute(
    staffRequestsRoute,
    apiRequest('/api/staff/requests', { cookies: staffCookies() }),
  );
  assert.equal(staffResponse.status(), 200);
  const staffBody = await staffResponse.json<{ requests: { id: string; student: { fullName: string } }[] }>();
  assert.equal(staffBody.requests.length, 1);
  assert.equal(staffBody.requests[0]?.id, ownRequestId);

  const adminResponse = await callRoute(
    staffRequestsRoute,
    apiRequest('/api/staff/requests', { cookies: { udgu_session: adminToken } }),
  );
  assert.equal(adminResponse.status(), 200);
  const adminBody = await adminResponse.json<{ requests: { id: string }[] }>();
  assert.equal(adminBody.requests.length, 2);
});

test('POST /api/staff/requests/[id]/decide: статус меняется, студент уведомлён; чужая → 404', async () => {
  const decideResponse = await callRouteWithParams(
    decideRequestRoute,
    apiRequest(`/api/staff/requests/${ownRequestId}/decide`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { status: 'IN_PROGRESS' },
    }),
    { id: ownRequestId },
  );
  assert.equal(decideResponse.status(), 200);
  const decideBody = await decideResponse.json<{ request: { status: string } }>();
  assert.equal(decideBody.request.status, 'IN_PROGRESS');

  // REJECTED без комментария → 400.
  const rejectedNoComment = await callRouteWithParams(
    decideRequestRoute,
    apiRequest(`/api/staff/requests/${ownRequestId}/decide`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { status: 'REJECTED' },
    }),
    { id: ownRequestId },
  );
  assert.equal(rejectedNoComment.status(), 400);

  // Чужая заявка → 404 (не 403).
  const foreign = await callRouteWithParams(
    decideRequestRoute,
    apiRequest(`/api/staff/requests/${otherRequestId}/decide`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { status: 'IN_PROGRESS' },
    }),
    { id: otherRequestId },
  );
  assert.equal(foreign.status(), 404);

  // Уведомление студенту о решении.
  const notificationsResponse = await callRoute(
    notificationsRoute,
    apiRequest('/api/notifications', { cookies: { udgu_session: studentToken } }),
  );
  const notificationsBody = await notificationsResponse.json<{
    notifications: { type: string; title: string }[];
  }>();
  assert.ok(
    notificationsBody.notifications.some((n) => n.type === 'REQUEST_STATUS' && /взята в работу/.test(n.title)),
    'студент уведомлён о решении сотрудника',
  );
});

// ---------------------------------------------------------------------------
// Объявления
// ---------------------------------------------------------------------------

test('POST /api/staff/announcements: STAFF не публикует ALL; своя группа — 201', async () => {
  const allResponse = await callRoute(
    createAnnouncementRoute,
    apiRequest('/api/staff/announcements', {
      method: 'POST',
      cookies: staffCookies(),
      body: { title: 'Всем', body: 'Текст', audience: 'ALL' },
    }),
  );
  assert.equal(allResponse.status(), 400, 'ALL — только для ADMIN');

  const ownGroupResponse = await callRoute(
    createAnnouncementRoute,
    apiRequest('/api/staff/announcements', {
      method: 'POST',
      cookies: staffCookies(),
      body: { title: 'Экзамен', body: 'Экзамен в пятницу', audience: 'GROUP', groupId: ownGroupId },
    }),
  );
  assert.equal(ownGroupResponse.status(), 201);

  const otherGroupResponse = await callRoute(
    createAnnouncementRoute,
    apiRequest('/api/staff/announcements', {
      method: 'POST',
      cookies: staffCookies(),
      body: { title: 'Чужая группа', body: 'Текст', audience: 'GROUP', groupId: otherGroupId },
    }),
  );
  assert.equal(otherGroupResponse.status(), 404, 'чужая группа не отличается от несуществующей');

  const listResponse = await callRoute(
    staffAnnouncementsRoute,
    apiRequest('/api/staff/announcements', { cookies: staffCookies() }),
  );
  assert.equal(listResponse.status(), 200);
  const listBody = await listResponse.json<{ announcements: { groupName: string | null }[] }>();
  assert.equal(listBody.announcements.length, 1);
  assert.equal(listBody.announcements[0]?.groupName, 'ПИ-33');
});

// ---------------------------------------------------------------------------
// Расписание: перенос и отмена
// ---------------------------------------------------------------------------

test('GET /api/staff/schedule: сотрудник видит только пары своего факультета', async () => {
  const response = await callRoute(
    staffScheduleRoute,
    apiRequest('/api/staff/schedule?from=2026-01-01&to=2027-01-01', { cookies: staffCookies() }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{ lessons: { id: string; groupName: string }[] }>();
  assert.equal(body.lessons.length, 1);
  assert.equal(body.lessons[0]?.id, ownEntryId);
  assert.equal(body.lessons[0]?.groupName, 'ПИ-33');
});

test('POST move/cancel: свой факультет — 200, чужой — 404', async () => {
  const foreignMove = await callRouteWithParams(
    moveLessonRoute,
    apiRequest(`/api/staff/schedule/${otherEntryId}/move`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { date: '2026-12-01' },
    }),
    { id: otherEntryId },
  );
  assert.equal(foreignMove.status(), 404);

  const move = await callRouteWithParams(
    moveLessonRoute,
    apiRequest(`/api/staff/schedule/${ownEntryId}/move`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { date: '2026-12-01', room: 'У-777', note: 'перенос' },
    }),
    { id: ownEntryId },
  );
  assert.equal(move.status(), 200);
  const moveBody = await move.json<{ lesson: { status: string; movedToRoom: string } }>();
  assert.equal(moveBody.lesson.status, 'MOVED');
  assert.equal(moveBody.lesson.movedToRoom, 'У-777');

  const cancel = await callRouteWithParams(
    cancelLessonRoute,
    apiRequest(`/api/staff/schedule/${ownEntryId}/cancel`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { reason: 'болезнь преподавателя' },
    }),
    { id: ownEntryId },
  );
  assert.equal(cancel.status(), 200);
  const cancelBody = await cancel.json<{ lesson: { status: string; note: string } }>();
  assert.equal(cancelBody.lesson.status, 'CANCELLED');
  assert.equal(cancelBody.lesson.note, 'болезнь преподавателя');

  // Повторная отмена → 409.
  const again = await callRouteWithParams(
    cancelLessonRoute,
    apiRequest(`/api/staff/schedule/${ownEntryId}/cancel`, {
      method: 'POST',
      cookies: staffCookies(),
      body: { reason: 'ещё раз' },
    }),
    { id: ownEntryId },
  );
  assert.equal(again.status(), 409);
});

// ---------------------------------------------------------------------------
// Болезни
// ---------------------------------------------------------------------------

test('GET /api/staff/sick-leaves: сотрудник — свой факультет', async () => {
  const response = await callRoute(
    staffSickLeavesRoute,
    apiRequest('/api/staff/sick-leaves?onlyActive=true', { cookies: staffCookies() }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{ sickLeaves: unknown[] }>();
  assert.ok(Array.isArray(body.sickLeaves));
});

// ---------------------------------------------------------------------------
// Верификации: очередь и поток фото
// ---------------------------------------------------------------------------

test('GET /api/staff/verifications + photo: очередь и image/* с no-store', async () => {
  const list = await callRoute(
    staffVerificationsRoute,
    apiRequest('/api/staff/verifications', { cookies: staffCookies() }),
  );
  assert.equal(list.status(), 200);
  const listBody = await list.json<{ verifications: { id: string; status: string; matchScore: number | null }[] }>();
  assert.equal(listBody.verifications.length, 1);
  assert.equal(listBody.verifications[0]?.status, 'PENDING');
  // Фикстура верификации не задаёт балл сверки (PENDING без распознавания).
  assert.equal(listBody.verifications[0]?.matchScore, null);

  const photo = await callRouteWithParams(
    verificationPhotoRoute,
    apiRequest(`/api/staff/verifications/${ownVerificationId}/photo`, { cookies: staffCookies() }),
    { id: ownVerificationId },
  );
  assert.equal(photo.status(), 200);
  assert.match(photo.response.headers.get('content-type') ?? '', /^image\//);
  assert.equal(photo.response.headers.get('cache-control'), 'no-store');
  assert.equal(photo.response.headers.get('content-disposition'), 'inline');
  // Путь из БД не утекает в заголовках.
  const headerDump = JSON.stringify(Object.fromEntries(photo.response.headers.entries()));
  assert.ok(!headerDump.includes('id-cards/'), 'путь хранилища не отдаётся клиенту');

  // Студент → 404.
  const studentPhoto = await callRouteWithParams(
    verificationPhotoRoute,
    apiRequest(`/api/staff/verifications/${ownVerificationId}/photo`, { cookies: { udgu_session: studentToken } }),
    { id: ownVerificationId },
  );
  assert.equal(studentPhoto.status(), 404);
});

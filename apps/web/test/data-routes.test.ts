/**
 * ДЫМОВЫЕ ТЕСТЫ ВСЕХ ДАТА-РОУТОВ: каждый маршрут кабинета реально
 * работает и отдаёт данные владельца сессии (не заглушка).
 *
 * Покрыты: profile, schedule (today/week), teachers, teachers/[id],
 * grades + grades/summary + grades/leverage, announcements,
 * sick-leave (GET/POST, в том числе фото справки в приватное хранилище),
 * notifications (лента/read/read-all), health.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dateKey } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import { GET as profileRoute } from '../app/api/profile/route';
import { GET as scheduleRoute } from '../app/api/schedule/route';
import { GET as teachersRoute } from '../app/api/teachers/route';
import { GET as teacherByIdRoute } from '../app/api/teachers/[id]/route';
import { GET as gradesRoute } from '../app/api/grades/route';
import { GET as gradesSummaryRoute } from '../app/api/grades/summary/route';
import { POST as leverageRoute } from '../app/api/grades/leverage/route';
import { GET as announcementsRoute } from '../app/api/announcements/route';
import {
  GET as sickLeaveRoute,
  POST as createSickLeaveRoute,
} from '../app/api/sick-leave/route';
import { GET as notificationsRoute } from '../app/api/notifications/route';
import { POST as markReadRoute } from '../app/api/notifications/[id]/read/route';
import { POST as readAllRoute } from '../app/api/notifications/read-all/route';
import { GET as healthRoute } from '../app/api/health/route';
import {
  closeWebTestDb,
  createGrade,
  createGroup,
  createNotification,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createVerification,
  resetWebTestData,
  utcDay,
} from './helpers';
import { apiRequest, callRoute, callRouteWithParams } from './http';

let sessionToken: string;
let teacherId: string;

test.before(async () => {
  await resetWebTestData();
  const group = await createGroup('ПИ-43');
  const student = await createStudent('student1', group.id);
  await createVerification(student.studentId, 'VERIFIED');

  const teacher = await createTeacher('teacher1');
  teacherId = teacher.teacherId;
  const subject = await createSubject('T-301', 'Веб-технологии');
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: dateKey(new Date()),
    startTime: '10:00',
    endTime: '11:20',
  });
  // Пара на завтра: «ближайшая пара» не должна зависеть от времени суток
  // (сегодняшняя пара к вечеру уже в прошлом).
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    startTime: '08:30',
    endTime: '09:50',
  });
  await createGrade(student.studentId, subject, 5, null, 'EXAM', 1);
  // Предстоящая работа текущего семестра — для расчёта «левериджа».
  await createGrade(student.studentId, subject, null, null, 'COURSEWORK', 3);
  await createNotification(student.userId, 'Изменение в расписании');

  const { createSession } = await import('@udgu/core');
  sessionToken = (await createSession(student.userId)).token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test('GET /api/profile → свой профиль', async () => {
  const response = await callRoute(profileRoute, apiRequest('/api/profile', { cookies: { udgu_session: sessionToken } }));
  assert.equal(response.status(), 200);
  const body = await response.json<{ profile: { fullName: string; groupName: string; verificationStatus: string } }>();
  assert.match(body.profile.fullName, /Иванов/);
  assert.equal(body.profile.groupName, 'ПИ-43');
  assert.equal(body.profile.verificationStatus, 'VERIFIED');
});

test('GET /api/schedule: today — занятия, ближайшая пара, свободные окна', async () => {
  const response = await callRoute(scheduleRoute, apiRequest('/api/schedule?view=today', { cookies: { udgu_session: sessionToken } }));
  assert.equal(response.status(), 200);
  const body = await response.json<{
    view: string;
    lessons: { startTime: string }[];
    nextLesson: { startTime: string } | null;
    freeGaps: { startTime: string }[];
  }>();
  assert.equal(body.view, 'today');
  assert.equal(body.lessons.length, 1);
  assert.equal(body.lessons[0]?.startTime, '10:00');
  // Ближайшая пара — завтрашняя (сегодняшняя к вечеру уже прошла).
  assert.equal(body.nextLesson?.startTime, '08:30', 'ближайшая пара найдена');
  assert.ok(Array.isArray(body.freeGaps), 'свободные окна посчитаны');
});

test('GET /api/schedule: week — сетка из 7 дней', async () => {
  const response = await callRoute(scheduleRoute, apiRequest('/api/schedule?view=week&offset=0', { cookies: { udgu_session: sessionToken } }));
  assert.equal(response.status(), 200);
  const body = await response.json<{ week: { days: { lessons: unknown[] }[] } }>();
  assert.equal(body.week.days.length, 7);
  const totalLessons = body.week.days.reduce((sum, day) => sum + day.lessons.length, 0);
  assert.ok(totalLessons >= 1, 'занятие группы попало в неделю');
});

test('GET /api/schedule: некорректный view → 400', async () => {
  const response = await callRoute(scheduleRoute, apiRequest('/api/schedule?view=decade', { cookies: { udgu_session: sessionToken } }));
  assert.equal(response.status(), 400);
});

test('GET /api/teachers → список с кафедрой и должностью', async () => {
  const response = await callRoute(teachersRoute, apiRequest('/api/teachers', { cookies: { udgu_session: sessionToken } }));
  assert.equal(response.status(), 200);
  const body = await response.json<{ teachers: { fullName: string; department: string; position: string }[] }>();
  assert.ok(body.teachers.length >= 1);
  const teacher = body.teachers[0];
  assert.ok(teacher !== undefined);
  assert.match(teacher.fullName, /Преподавательская/);
  assert.match(teacher.department, /Кафедра/);
  assert.equal(teacher.position, 'доцент');
});

test('GET /api/teachers/[id] → расписание на 2 недели + часы приёма; неизвестный id → 404', async () => {
  const response = await callRouteWithParams(
    teacherByIdRoute,
    apiRequest(`/api/teachers/${teacherId}`, { cookies: { udgu_session: sessionToken } }),
    { id: teacherId },
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    teacher: { fullName: string; lessons: { groupName: string }[]; officeHours: unknown[] };
  }>();
  assert.match(body.teacher.fullName, /Преподавательская/);
  assert.ok(body.teacher.lessons.length >= 1, 'пары преподавателя видны студенту');
  assert.equal(body.teacher.lessons[0]?.groupName, 'ПИ-43');
  assert.ok(Array.isArray(body.teacher.officeHours));

  const unknown = await callRouteWithParams(
    teacherByIdRoute,
    apiRequest('/api/teachers/00000000-0000-0000-0000-000000000000', {
      cookies: { udgu_session: sessionToken },
    }),
    { id: '00000000-0000-0000-0000-000000000000' },
  );
  assert.equal(unknown.status(), 404);
});

test('GET /api/grades + summary → свои оценки и сводка', async () => {
  const grades = await callRoute(gradesRoute, apiRequest('/api/grades?semester=1', { cookies: { udgu_session: sessionToken } }));
  assert.equal(grades.status(), 200);
  const gradesBody = await grades.json<{ semesters: { entries: { value: number | null }[] }[] }>();
  assert.deepEqual(
    gradesBody.semesters.flatMap((semester) => semester.entries.map((entry) => entry.value)),
    [5],
  );

  const summary = await callRoute(gradesSummaryRoute, apiRequest('/api/grades/summary', { cookies: { udgu_session: sessionToken } }));
  assert.equal(summary.status(), 200);
  const summaryBody = await summary.json<{
    summary: { averageScore: number | null; debts: unknown[]; trend: { direction: string }; toImprove: unknown[] };
  }>();
  assert.equal(summaryBody.summary.averageScore, 5);
  assert.equal(summaryBody.summary.trend.direction, 'UNKNOWN');
  assert.ok(Array.isArray(summaryBody.summary.toImprove));
});

test('GET /api/announcements → лента (может быть пустой)', async () => {
  const response = await callRoute(announcementsRoute, apiRequest('/api/announcements', { cookies: { udgu_session: sessionToken } }));
  assert.equal(response.status(), 200);
  const body = await response.json<{ announcements: unknown[] }>();
  assert.ok(Array.isArray(body.announcements));
});

test('GET/POST /api/sick-leave → отметка «болею», пересечение → 409', async () => {
  const from = dateKey(new Date());
  const to = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

  // POST — multipart/form-data (как из формы кабинета): период + причина.
  const form = new FormData();
  form.set('dateFrom', from);
  form.set('dateTo', to);
  form.set('reason', 'ОРВИ');

  const created = await callRoute(
    createSickLeaveRoute,
    apiRequest('/api/sick-leave', {
      method: 'POST',
      cookies: { udgu_session: sessionToken },
      formData: form,
    }),
  );
  assert.equal(created.status(), 201);
  const createdBody = await created.json<{ sickLeave: { reason: string | null; hasAttachment: boolean } }>();
  assert.equal(createdBody.sickLeave.reason, 'ОРВИ');
  assert.equal(createdBody.sickLeave.hasAttachment, false);

  const overlapping = await callRoute(
    createSickLeaveRoute,
    apiRequest('/api/sick-leave', {
      method: 'POST',
      cookies: { udgu_session: sessionToken },
      formData: (() => {
        const overlap = new FormData();
        overlap.set('dateFrom', from);
        overlap.set('dateTo', to);
        return overlap;
      })(),
    }),
  );
  assert.equal(overlapping.status(), 409);

  const list = await callRoute(sickLeaveRoute, apiRequest('/api/sick-leave', { cookies: { udgu_session: sessionToken } }));
  assert.equal(list.status(), 200);
  const listBody = await list.json<{ items: { reason: string | null }[]; sickNow: boolean }>();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.sickNow, true, 'студент болеет прямо сейчас');
});

test('POST /api/sick-leave: фото справки уходит в приватное хранилище', async () => {
  const from = dateKey(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
  const to = dateKey(new Date(Date.now() + 12 * 24 * 60 * 60 * 1000));

  const form = new FormData();
  form.set('dateFrom', from);
  form.set('dateTo', to);
  form.set('reason', 'Грипп, справка от врача');
  // Минимальный валидный JPEG: маршрут проверяет MIME и размер, содержимое
  // не декодирует — сюда попадёт любой файл с нужным типом.
  form.set(
    'certificate',
    new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], 'spravka.jpg', { type: 'image/jpeg' }),
  );

  const created = await callRoute(
    createSickLeaveRoute,
    apiRequest('/api/sick-leave', {
      method: 'POST',
      cookies: { udgu_session: sessionToken },
      formData: form,
    }),
  );
  assert.equal(created.status(), 201);
  const body = await created.json<{ sickLeave: { hasAttachment: boolean; dateFrom: string } }>();
  assert.equal(body.sickLeave.hasAttachment, true, 'справка прикреплена');

  // Файл лежит в приватном хранилище, вне webroot: путь в БД относительный.
  const stored = await getPrisma().sickLeave.findMany({
    where: { dateFrom: utcDay(from) },
    select: { attachmentPath: true },
  });
  assert.equal(stored.length, 1);
  assert.match(stored[0]?.attachmentPath ?? '', /^sick-leave-certificates\/[A-Za-z0-9-]+\/[0-9a-f-]+\.jpg$/);
  assert.ok(
    existsSync(resolve(process.env.STORAGE_DIR ?? 'storage', stored[0]?.attachmentPath ?? '')),
    'файл реально сохранён в хранилище',
  );
});

test('POST /api/sick-leave: неверный формат фото справки → 400, отметка не создана', async () => {
  const from = dateKey(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000));
  const form = new FormData();
  form.set('dateFrom', from);
  form.set('dateTo', dateKey(new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)));
  form.set('certificate', new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' }));

  const rejected = await callRoute(
    createSickLeaveRoute,
    apiRequest('/api/sick-leave', {
      method: 'POST',
      cookies: { udgu_session: sessionToken },
      formData: form,
    }),
  );
  assert.equal(rejected.status(), 400);
  const stored = await getPrisma().sickLeave.findMany({ where: { dateFrom: utcDay(from) } });
  assert.equal(stored.length, 0, 'отметка с неверным файлом не создана');
});

test('GET /api/notifications, read, read-all', async () => {
  const list = await callRoute(notificationsRoute, apiRequest('/api/notifications', { cookies: { udgu_session: sessionToken } }));
  assert.equal(list.status(), 200);
  const listBody = await list.json<{ notifications: { id: string; read: boolean }[]; unreadCount: number }>();
  assert.equal(listBody.notifications.length, 1);
  assert.equal(listBody.unreadCount, 1);

  const notificationId = listBody.notifications[0]?.id;
  assert.ok(notificationId !== undefined);
  const read = await callRouteWithParams(
    markReadRoute,
    apiRequest(`/api/notifications/${notificationId}/read`, { method: 'POST', cookies: { udgu_session: sessionToken } }),
    { id: notificationId },
  );
  assert.equal(read.status(), 200);

  const readAll = await callRoute(readAllRoute, apiRequest('/api/notifications/read-all', { method: 'POST', cookies: { udgu_session: sessionToken } }));
  assert.equal(readAll.status(), 200);
  const readAllBody = await readAll.json<{ updated: number }>();
  assert.equal(readAllBody.updated, 0, 'непрочитанных уже не осталось');
});

test('GET /api/health → реальная проверка БД', async () => {
  const response = await callRoute(healthRoute, apiRequest('/api/health'));
  assert.equal(response.status(), 200);
  const body = await response.json<{ status: string }>();
  assert.equal(body.status, 'ok');
});

// ---------------------------------------------------------------------------
// «Леверидж»: расчёт баллов до целевого среднего (решение Council)
// ---------------------------------------------------------------------------

test('POST /api/grades/leverage → сколько баллов нужно на предстоящих работах', async () => {
  // Своя фикстура: экзамен 5 (1 семестр), курсовая 4 (2 семестр) и одна
  // несданная работа (3 семестр). Средний балл 4,50, цель 4,60:
  // neededSum = 4,6 × 3 − 9 = 4,8, neededAverage = 4,8 на работу.
  const group = await getPrisma().group.findFirst({ select: { id: true } });
  const subject = await getPrisma().subject.findFirst({ select: { id: true } });
  assert.ok(group !== null, 'группа фикстуры существует');
  assert.ok(subject !== null, 'предмет фикстуры существует');

  const student = await createStudent('student-leverage', group.id);
  await createVerification(student.studentId, 'VERIFIED');
  await createGrade(student.studentId, subject.id, 5, null, 'EXAM', 1);
  await createGrade(student.studentId, subject.id, 4, null, 'COURSEWORK', 2);
  await createGrade(student.studentId, subject.id, null, null, 'EXAM', 3);

  const { createSession } = await import('@udgu/core');
  const token = (await createSession(student.userId)).token;

  const response = await callRoute(
    leverageRoute,
    apiRequest('/api/grades/leverage', {
      method: 'POST',
      cookies: { udgu_session: token },
      body: { targetGpa: 4.6 },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    result: {
      targetGpa: number;
      gradedCount: number;
      pendingCount: number;
      currentAverage: number | null;
      neededSumOnPending: number | null;
      neededAverageOnPending: number | null;
      maxPossibleAverage: number | null;
      achievable: boolean;
      alreadyAchieved: boolean;
    };
  }>();
  assert.equal(body.result.targetGpa, 4.6);
  assert.equal(body.result.gradedCount, 2);
  assert.equal(body.result.pendingCount, 1);
  assert.equal(body.result.currentAverage, 4.5);
  assert.equal(body.result.neededSumOnPending, 4.8);
  assert.equal(body.result.neededAverageOnPending, 4.8);
  assert.equal(body.result.maxPossibleAverage, 4.67, 'максимум — если всё сдать на 5');
  assert.equal(body.result.achievable, true);
  assert.equal(body.result.alreadyAchieved, false, 'цель ещё не достигнута');
});

test('POST /api/grades/leverage: цель выше максимума → честное «недостижимо»', async () => {
  const student = await getPrisma().student.findFirst({
    where: { user: { login: 'student-leverage' } },
    select: { userId: true },
  });
  assert.ok(student !== null, 'студент фикстуры «левериджа» существует');
  const { createSession } = await import('@udgu/core');
  const token = (await createSession(student.userId)).token;

  const response = await callRoute(
    leverageRoute,
    apiRequest('/api/grades/leverage', {
      method: 'POST',
      cookies: { udgu_session: token },
      body: { targetGpa: 5 },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    result: { neededSumOnPending: number | null; achievable: boolean; alreadyAchieved: boolean };
  }>();
  assert.equal(body.result.neededSumOnPending, 6, 'на одну предстоящую работу нужно 6 баллов');
  assert.equal(body.result.achievable, false, '6 > 5: цель недостижима');
  assert.equal(body.result.alreadyAchieved, false);
});

test('POST /api/grades/leverage: цель вне шкалы → 400', async () => {
  const response = await callRoute(
    leverageRoute,
    apiRequest('/api/grades/leverage', {
      method: 'POST',
      cookies: { udgu_session: sessionToken },
      body: { targetGpa: 9 },
    }),
  );
  assert.equal(response.status(), 400);
  const body = await response.json<{ error: { code: string } }>();
  assert.equal(body.error.code, 'INVALID_INPUT');
});

test('POST /api/grades/leverage: неверифицированный студент → 403 VERIFICATION_REQUIRED', async () => {
  const group = await getPrisma().group.findFirst({ select: { id: true } });
  assert.ok(group !== null, 'группа фикстуры существует');
  const unverified = await createStudent('student-unverified', group.id);
  const { createSession } = await import('@udgu/core');
  const token = (await createSession(unverified.userId)).token;

  const response = await callRoute(
    leverageRoute,
    apiRequest('/api/grades/leverage', {
      method: 'POST',
      cookies: { udgu_session: token },
      body: { targetGpa: 4.5 },
    }),
  );
  assert.equal(response.status(), 403);
  const body = await response.json<{ error: { code: string } }>();
  assert.equal(body.error.code, 'VERIFICATION_REQUIRED');
});

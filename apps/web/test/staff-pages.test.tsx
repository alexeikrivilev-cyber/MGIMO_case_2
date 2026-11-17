/**
 * ТЕСТЫ СТРАНИЦ КАБИНЕТА СОТРУДНИКА ДЕКАНАТА И ПЕРЕПИСКИ (P2-A).
 *
 * Подход тот же, что у страниц кабинета студента (pages.test.tsx):
 * серверные загрузчики (lib/page-data.ts) вызываются с НАСТОЯЩЕЙ cookie
 * сессии против тестовой БД — это тот же путь, что у страниц
 * (cookie → validateSession → сервисы packages/core). Виды рендерятся
 * через renderToStaticMarkup и проверяются по содержимому.
 *
 * Проверяем:
 * - каждый экран /staff/* рендерится из реальных данных: сводка, очередь
 *   заявок, очередь верификаций (с фото через авторизованный маршрут),
 *   болезни, форма объявления, расписание с переносом/отменой;
 * - middleware: студент на /staff и /staff/* → 404 (не 403!),
 *   сотрудник/админ → 200;
 * - преподаватель (STAFF без faculty) видит честное «раздел недоступен»,
 *   а не падение;
 * - форма объявления: zod-ошибка на пустых полях (схема ядра — та же,
 *   что у роута) и 400 от роута;
 * - /messages: неверифицированный студент видит заглушку гейта (не 500),
 *   преподаватель видит ФИО и группу автора;
 * - IDOR: student2 не открывает чужой диалог по conversationId;
 * - мобильный 360 px и доступность новых экранов.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createSession, staffAnnouncementSchema, dateKey } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import middleware from '../middleware';
import { POST as createAnnouncementRoute } from '../app/api/staff/announcements/route';
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
import { apiRequest, callRoute } from './http';

(globalThis as unknown as { React: typeof React }).React = React;

// Виды и загрузчики импортируются после установки глобального React.
const { StaffDashboardView } = await import('../app/(staff)/staff/dashboard-screen');
const { StaffRequestsView } = await import('../app/(staff)/staff/requests/requests-screen');
const { StaffVerificationsView } = await import('../app/(staff)/staff/verifications/verifications-screen');
const { StaffSickLeavesView } = await import('../app/(staff)/staff/sick-leaves/sick-leaves-screen');
const { StaffAnnouncementsView } = await import('../app/(staff)/staff/announcements/announcements-screen');
const { StaffScheduleView } = await import('../app/(staff)/staff/schedule/schedule-screen');
const { MessagesView } = await import('../app/(messages)/messages/messages-screen');
const { StaffShell } = await import('../components/StaffShell');
const { MessagesShell } = await import('../components/MessagesShell');
const {
  loadStaffDashboardPageData,
  loadStaffRequestsPageData,
  loadStaffVerificationsPageData,
  loadStaffSickLeavesPageData,
  loadStaffSchedulePageData,
  loadStaffAnnouncementsPageData,
  loadMessagesPageData,
} = await import('../lib/page-data');

/**
 * Контекст роутера: виды содержат клиентские острова (формы, кнопки),
 * которые вызывают useRouter — вне App Router он бросает исключение.
 */
const ROUTER_CONTEXT = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  prefetch: () => Promise.resolve(),
  back: () => {},
  forward: () => {},
} as never;

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={ROUTER_CONTEXT}>{element}</AppRouterContext.Provider>,
  );
}

/** Рендер оболочки по пути: StaffShell берёт путь из usePathname. */
function renderShellAtPath(pathname: string, children: React.ReactNode): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={ROUTER_CONTEXT}>
      <PathnameContext.Provider value={pathname}>
        <StaffShell>{children}</StaffShell>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

const TODAY = dateKey(new Date());
const TOMORROW = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
const DAY_AFTER = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

let staffCookie: string;
let otherStaffCookie: string;
let adminCookie: string;
let teacherCookie: string;
let studentCookie: string;
let unverifiedCookie: string;
let otherStudentCookie: string;
let ownGroupId: string;
let otherGroupId: string;
let ownRequestId: string;
let ownVerificationId: string;
let ownEntryId: string;
let movedEntryId: string;
let cancelledEntryId: string;
let ownConversationId: string;
let otherConversationId: string;
let teacherUserId: string;
let studentUserId: string;

test.before(async () => {
  await resetWebTestData();

  const ownGroup = await createGroup('ПИ-37', FACULTY_A);
  const otherGroup = await createGroup('ЮР-37', FACULTY_B, 3, '40.03.01 Юриспруденция');
  ownGroupId = ownGroup.id;
  otherGroupId = otherGroup.id;

  const ownStudent = await createStudent('student1', ownGroup.id, {
    lastName: 'Иванов',
    firstName: 'Александр',
    faculty: FACULTY_A,
  });
  const unverified = await createStudent('student2', ownGroup.id, {
    lastName: 'Петрова',
    firstName: 'Мария',
    faculty: FACULTY_A,
  });
  const otherStudent = await createStudent('student3', otherGroup.id, {
    lastName: 'Сидоров',
    firstName: 'Пётр',
    faculty: FACULTY_B,
  });
  const teacher = await createTeacher('teacher1');
  teacherUserId = teacher.userId;
  studentUserId = ownStudent.userId;

  // Гейт верификации: student1 и student3 — верифицированы, student2 — нет.
  await createVerification(ownStudent.studentId, 'VERIFIED');
  await createVerification(otherStudent.studentId, 'VERIFIED');
  await createVerification(unverified.studentId, 'PENDING');

  // Заявка своего факультета (для очереди сотрудника).
  ownRequestId = await createRequest(ownStudent.studentId, 'NEW');

  // Расписание: обычная пара, перенос и отмена.
  const subject = await createSubject('T-950', 'Тестовый предмет кабинета');
  ownEntryId = await createScheduleEntry({
    groupId: ownGroup.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '10:00',
    endTime: '11:20',
    room: 'У-101',
  });
  await createScheduleEntry({
    groupId: ownGroup.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: TOMORROW,
    startTime: '13:30',
    endTime: '14:50',
    room: 'У-202',
  });
  movedEntryId = (
    await getPrisma().scheduleEntry.create({
    data: {
      groupId: ownGroup.id,
      subjectId: subject,
      teacherId: teacher.teacherId,
      date: utcDay(DAY_AFTER),
      startTime: '10:00',
      endTime: '11:20',
      room: 'У-303',
      type: 'SEMINAR',
      status: 'MOVED',
      note: 'Перенос согласован с кафедрой',
      movedToDate: utcDay(TOMORROW),
      movedToRoom: 'Л-305',
    },
    select: { id: true },
    })
  ).id;
  cancelledEntryId = (
    await getPrisma().scheduleEntry.create({
    data: {
      groupId: ownGroup.id,
      subjectId: subject,
      teacherId: teacher.teacherId,
      date: utcDay(DAY_AFTER),
      startTime: '15:00',
      endTime: '16:20',
      room: 'У-304',
      type: 'LECTURE',
      status: 'CANCELLED',
      note: 'Преподаватель на научной конференции',
    },
    select: { id: true },
    })
  ).id;

  // Заявка student2 на верификации ждёт решения сотрудника: распознанные
  // поля и балл сверки — то, по чему сотрудник принимает решение.
  const pendingVerification = await getPrisma().studentVerification.update({
    where: { studentId: unverified.studentId },
    data: {
      recognizedLastName: 'Петрова',
      recognizedFirstName: 'Мария',
      recognizedGroupName: 'Группа-фикстура',
      recognizedCardNumber: 'UDGU-TEST-0000',
      matchScore: 0.62,
    },
    select: { id: true },
  });
  ownVerificationId = pendingVerification.id;

  // Болезни: активная сегодня и завершившаяся.
  await getPrisma().sickLeave.create({
    data: {
      studentId: ownStudent.studentId,
      dateFrom: utcDay(TODAY),
      dateTo: utcDay(DAY_AFTER),
      reason: 'ОРВИ',
    },
  });
  await getPrisma().sickLeave.create({
    data: {
      studentId: ownStudent.studentId,
      dateFrom: utcDay(dateKey(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000))),
      dateTo: utcDay(dateKey(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))),
      reason: 'Грипп',
    },
  });

  // Объявление сотрудника — для списка на странице объявлений.
  const staff = await createUser('staff1', 'STAFF');
  await getPrisma().user.update({ where: { id: staff.id }, data: { faculty: FACULTY_A } });
  const admin = await createUser('admin1', 'ADMIN');
  await getPrisma().announcement.create({
    data: {
      title: 'Сдача курсовых работ',
      body: 'Группа ПИ-37: сдача до 20 декабря.',
      audience: 'GROUP',
      faculty: FACULTY_A,
      groupId: ownGroup.id,
      authorId: staff.id,
    },
  });

  // Переписка: student1 ↔ teacher1 (непрочитанный ответ преподавателя).
  const ownConversation = await getPrisma().conversation.create({
    data: { studentId: ownStudent.studentId, teacherId: teacher.teacherId },
    select: { id: true },
  });
  ownConversationId = ownConversation.id;
  await getPrisma().message.create({
    data: {
      conversationId: ownConversation.id,
      authorUserId: ownStudent.userId,
      body: 'Когда можно подойти по курсовой?',
      readAt: new Date(),
    },
  });
  await getPrisma().message.create({
    data: {
      conversationId: ownConversation.id,
      authorUserId: teacher.userId,
      body: 'Четверг, 14:00, аудитория У-418.',
      readAt: null,
    },
  });

  // Диалог student3: student1 не должен его открыть (анти-IDOR).
  const otherConversation = await getPrisma().conversation.create({
    data: { studentId: otherStudent.studentId, teacherId: teacher.teacherId },
    select: { id: true },
  });
  otherConversationId = otherConversation.id;
  await getPrisma().message.create({
    data: {
      conversationId: otherConversation.id,
      authorUserId: otherStudent.userId,
      body: 'Чужая переписка',
      readAt: null,
    },
  });

  // Сотрудник другого института: его очереди пусты (проверка пустых состояний).
  const otherStaff = await createUser('staff2', 'STAFF');
  await getPrisma().user.update({ where: { id: otherStaff.id }, data: { faculty: FACULTY_B } });

  staffCookie = `udgu_session=${(await createSession(staff.id)).token}`;
  otherStaffCookie = `udgu_session=${(await createSession(otherStaff.id)).token}`;
  adminCookie = `udgu_session=${(await createSession(admin.id)).token}`;
  teacherCookie = `udgu_session=${(await createSession(teacher.userId)).token}`;
  studentCookie = `udgu_session=${(await createSession(ownStudent.userId)).token}`;
  unverifiedCookie = `udgu_session=${(await createSession(unverified.userId)).token}`;
  otherStudentCookie = `udgu_session=${(await createSession(otherStudent.userId)).token}`;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

// ---------------------------------------------------------------------------
// Гейт доступа: middleware
// ---------------------------------------------------------------------------

test('middleware: /staff и /staff/* студенту — 404, сотруднику — 200', async () => {
  for (const path of ['/staff', '/staff/requests', '/staff/verifications', '/staff/sick-leaves', '/staff/announcements', '/staff/schedule']) {
    const studentResponse = await middleware(new NextRequest(`http://localhost${path}`, { headers: { cookie: studentCookie } }));
    assert.equal(studentResponse.status, 404, `${path} для студента — 404 (раздел «не существует»)`);
    assert.notEqual(studentResponse.headers.get('location'), '/login', 'без редиректа на вход');

    const staffResponse = await middleware(new NextRequest(`http://localhost${path}`, { headers: { cookie: staffCookie } }));
    assert.equal(staffResponse.status, 200, `${path} для сотрудника — 200`);

    const adminResponse = await middleware(new NextRequest(`http://localhost${path}`, { headers: { cookie: adminCookie } }));
    assert.equal(adminResponse.status, 200, `${path} для администратора — 200`);
  }
});

test('middleware: /messages закрыт для анонима, открыт студенту и преподавателю', async () => {
  const anonymous = await middleware(new NextRequest('http://localhost/messages'));
  assert.equal(anonymous.status, 307, 'без сессии — редирект на вход');
  assert.equal(anonymous.headers.get('location'), 'http://localhost/login');

  for (const [cookie, label] of [
    [studentCookie, 'студент'],
    [teacherCookie, 'преподаватель'],
  ] as const) {
    const response = await middleware(new NextRequest('http://localhost/messages', { headers: { cookie } }));
    assert.equal(response.status, 200, `/messages для ${label} — 200`);
  }
});

// ---------------------------------------------------------------------------
// Дашборд сотрудника
// ---------------------------------------------------------------------------

test('сводка сотрудника: счётчики очередей института и ссылки на разделы', async () => {
  const result = await loadStaffDashboardPageData(staffCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<StaffDashboardView result={result} />);

  assert.match(html, /Кабинет деканата/, 'заголовок экрана');
  assert.match(html, /Институт математики, информационных технологий и физики/, 'институт сотрудника');
  assert.match(html, /data-testid="queue-requests"/, 'плитка заявок');
  assert.match(html, /data-testid="queue-verifications"/, 'плитка верификаций');
  assert.match(html, /data-testid="queue-sick"/, 'плитка болезней');
  assert.match(html, /1 в очереди/, 'счётчик очереди посчитан');
  assert.match(html, /href="\/staff\/requests"/, 'быстрая ссылка на очередь заявок');
  assert.match(html, /href="\/staff\/schedule"/, 'быстрая ссылка на расписание');
});

test('администратор видит все институты в сводке', async () => {
  const result = await loadStaffDashboardPageData(adminCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.dashboard.faculty, null);
  const html = render(<StaffDashboardView result={result} />);
  assert.match(html, /Все институты университета/);
});

test('преподаватель (STAFF без факультета) видит честное «раздел недоступен»', async () => {
  const result = await loadStaffDashboardPageData(teacherCookie);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'forbidden', 'кабинет деканата преподавателю закрыт');

  const html = render(<StaffDashboardView result={result} />);
  assert.match(html, /data-testid="staff-forbidden"/, 'объяснение вместо падения');
  assert.match(html, /Переписка со студентами/, 'преподавателю предложен его раздел');
});

// ---------------------------------------------------------------------------
// Очередь заявок
// ---------------------------------------------------------------------------

test('очередь заявок: студент, тип, данные формы, статус, форма решения', async () => {
  const result = await loadStaffRequestsPageData(staffCookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requests.length, 1, 'только заявки своего института');
  const html = render(<StaffRequestsView result={result} />);

  assert.match(html, /Иванов Александр Дмитриевич/, 'ФИО студента в карточке');
  assert.match(html, /ПИ-37/, 'группа студента');
  assert.match(html, /Справка/, 'тип заявки');
  assert.match(html, /По месту требования/, 'данные формы');
  assert.match(html, /Принять решение/, 'действие сотрудника');
  assert.match(html, /Взять в работу/, 'вариант статуса');
  assert.match(html, /Отклонить \(нужен комментарий\)/, 'отказ требует комментарий');
  assert.match(html, /Фильтр по статусу заявки/, 'фильтр с доступным именем');
});

test('очередь заявок: фильтр по статусу и пустое состояние с объяснением', async () => {
  const ready = await loadStaffRequestsPageData(staffCookie, 'READY');
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.equal(ready.value.status, 'READY');
  assert.equal(ready.value.requests.length, 0);
  const html = render(<StaffRequestsView result={ready} />);
  assert.match(html, /В этом статусе заявок нет/, 'пустое состояние объясняет, что делать');
  assert.match(html, /Показать все/, 'предложение переключить фильтр');

  // Некорректный статус в query → все заявки (без падения).
  const broken = await loadStaffRequestsPageData(staffCookie, 'НЕВЕРНЫЙ');
  assert.equal(broken.ok, true);
  if (!broken.ok) return;
  assert.equal(broken.value.status, null);
});

// ---------------------------------------------------------------------------
// Очередь верификаций
// ---------------------------------------------------------------------------

test('очередь верификаций: распознанные поля, балл сверки, фото через авторизованный маршрут', async () => {
  const result = await loadStaffVerificationsPageData(staffCookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.verifications.length, 2, 'обе заявки института');
  assert.equal(result.value.verifications[0]?.status, 'PENDING', 'ожидающие решения — сверху');
  const html = render(<StaffVerificationsView result={result} />);

  assert.match(html, /Петрова Мария Дмитриевич/, 'ФИО студента');
  assert.match(html, /ПИ-37/, 'группа студента');
  assert.match(html, /Петрова Мария/, 'распознанные с фото поля');
  assert.match(html, /Группа-фикстура/, 'распознанная группа с карточки');
  assert.match(html, /UDGU-TEST-0000/, 'распознанный номер билета');
  assert.match(html, /0,62/, 'балл сверки с русской запятой');
  // Фото — ТОЛЬКО через авторизованный маршрут кабинета.
  assert.match(html, /src="\/api\/staff\/verifications\/[^"]+\/photo"/, 'img берёт фото у авторизованного роута');
  assert.equal(html.includes('/storage/'), false, 'прямой ссылки на хранилище нет');
  assert.match(html, /Одобрить/, 'действие «одобрить»');
  assert.match(html, /Отклонить/, 'действие «отклонить»');
});

test('очередь верификаций: пустое состояние для фильтра без заявок', async () => {
  const result = await loadStaffVerificationsPageData(staffCookie, 'REJECTED');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<StaffVerificationsView result={result} />);
  assert.match(html, /В этом статусе заявок нет/);
});

// ---------------------------------------------------------------------------
// Болезни
// ---------------------------------------------------------------------------

test('болезни: активные и завершившиеся отметки, период, причина, справка', async () => {
  const all = await loadStaffSickLeavesPageData(staffCookie, false);
  assert.equal(all.ok, true);
  if (!all.ok) return;
  assert.equal(all.value.sickLeaves.length, 2);
  assert.equal(all.value.activeCount, 1);
  const html = render(<StaffSickLeavesView result={all} />);

  assert.match(html, /Болеет сейчас/, 'активная отметка словом, не только цветом');
  assert.match(html, /Завершилась/, 'завершившаяся отметка');
  assert.match(html, /ОРВИ/, 'причина отметки');
  assert.match(html, /Без справки/, 'факт наличия справки');
  assert.match(html, /Фильтр отметок о болезни/, 'фильтр с доступным именем');

  const activeOnly = await loadStaffSickLeavesPageData(staffCookie, true);
  assert.equal(activeOnly.ok, true);
  if (!activeOnly.ok) return;
  assert.equal(activeOnly.value.sickLeaves.length, 1, 'только болеющие сейчас');
});

test('болезни: пустое состояние, когда в институте никто не болеет', async () => {
  // Сотрудник другого института: у его студентов отметок о болезни нет.
  const result = await loadStaffSickLeavesPageData(otherStaffCookie, true);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sickLeaves.length, 0);
  const html = render(<StaffSickLeavesView result={result} />);
  assert.match(html, /Сейчас никто не болеет/, 'пустое состояние с объяснением');
});

// ---------------------------------------------------------------------------
// Объявления
// ---------------------------------------------------------------------------

test('объявления: форма публикации, аудитории, закрепление, список', async () => {
  const result = await loadStaffAnnouncementsPageData(staffCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<StaffAnnouncementsView result={result} />);

  assert.match(html, /Новое объявление/, 'форма публикации');
  assert.match(html, /Весь университет/, 'аудитория «все»');
  assert.match(html, /Институт<\/option>/, 'аудитория «институт»');
  assert.match(html, /Группа<\/option>/, 'аудитория «группа»');
  assert.match(html, /ПИ-37/, 'группа института в выпадающем списке');
  assert.match(html, /Закрепить сверху/, 'закрепление объявления');
  assert.match(html, /Сдача курсовых работ/, 'опубликованное объявление в списке');
  assert.match(html, /Группа · ПИ-37/, 'аудитория объявления указана');
});

test('форма объявления: zod-ошибка на пустых полях (схема ядра, та же что у роута)', () => {
  const parsed = staffAnnouncementSchema.safeParse({ title: '', body: '', audience: 'GROUP' });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const messages = parsed.error.issues.map((issue) => issue.message);
  assert.ok(messages.some((message) => /заголовок/i.test(message)), 'ошибка про заголовок');
  assert.ok(messages.some((message) => /текст/i.test(message)), 'ошибка про текст');
});

test('POST /api/staff/announcements: пустые поля → 400 с сообщениями формы', async () => {
  const response = await callRoute(
    createAnnouncementRoute,
    apiRequest('/api/staff/announcements', {
      method: 'POST',
      cookies: { udgu_session: staffCookie },
      body: { title: '', body: '', audience: 'FACULTY' },
    }),
  );
  assert.equal(response.status(), 400);
  const body = await response.json<{ error: { code: string; details: string[] } }>();
  assert.equal(body.error.code, 'INVALID_INPUT');
  assert.ok(body.error.details.length > 0, 'сообщения формы вернулись клиенту');
});

// ---------------------------------------------------------------------------
// Расписание
// ---------------------------------------------------------------------------

test('расписание сотрудника: пары, перенос и отмена оформлены формой и текстом', async () => {
  const result = await loadStaffSchedulePageData(staffCookie, undefined, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<StaffScheduleView result={result} />);

  assert.match(html, /Расписание групп/, 'заголовок экрана');
  assert.match(html, /Тестовый предмет кабинета/, 'предмет пары');
  assert.match(html, /У-101/, 'аудитория');
  assert.match(html, /Перенесена/, 'статус переноса словом');
  assert.match(html, /Л-305/, 'новая аудитория перенесённой пары');
  assert.match(html, /Отмена|Отменена/, 'статус отмены словом');
  assert.match(html, /Преподаватель на научной конференции/, 'причина отмены текстом');
  assert.match(html, /Перенести или отменить/, 'действие по паре');
  assert.match(html, /Новая дата/, 'поле новой даты переноса');
  assert.match(html, /Отменить пару<\/option>/, 'альтернативное действие — отмена');
  assert.ok(movedEntryId.length > 0 && cancelledEntryId.length > 0 && ownEntryId.length > 0, 'фикстуры расписания созданы');
});

// ---------------------------------------------------------------------------
// Переписка
// ---------------------------------------------------------------------------

test('переписка студента: диалоги, сообщения, форма ответа', async () => {
  const result = await loadMessagesPageData(studentCookie, ownConversationId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mode, 'student');
  assert.equal(result.value.conversations.length, 1);
  const html = render(<MessagesView result={result} />);

  assert.match(html, /Преподавательская Ольга Игоревна/, 'собеседник-преподаватель');
  assert.match(html, /Написать преподавателю/, 'кнопка создания диалога');
  assert.match(html, /data-testid="conversation-panel"/, 'панель диалога');
  assert.match(html, /Когда можно подойти по курсовой\?/, 'сообщение студента');
  assert.match(html, /Четверг, 14:00, аудитория У-418\./, 'ответ преподавателя');
  assert.match(html, /1 новых/, 'счётчик непрочитанных');
  assert.match(html, /Отправить/, 'отправка сообщения');
});

test('переписка преподавателя: видны ФИО и группа автора (требование BRIEF v2)', async () => {
  const result = await loadMessagesPageData(teacherCookie, ownConversationId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mode, 'teacher');
  const html = render(<MessagesView result={result} />);

  assert.match(html, /Иванов Александр Дмитриевич/, 'ФИО автора в диалоге');
  assert.match(html, /группа ПИ-37/, 'группа автора в списке диалогов');
  assert.match(html, /Группа ПИ-37/, 'группа автора в панели диалога');
  assert.match(html, /Диалоги со студентами/, 'режим преподавателя');
});

test('переписка неверифицированного студента: заглушка гейта, не 500', async () => {
  const result = await loadMessagesPageData(unverifiedCookie, undefined);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'verification-required', 'гейт верификации вместо данных');

  const html = render(<MessagesView result={result} />);
  assert.match(html, /data-testid="verification-gate"/, 'карточка гейта верификации');
  assert.match(html, /Верифицировать студенческий билет/, 'призыв верифицировать');
});

test('IDOR: student1 не открывает чужой диалог по conversationId', async () => {
  const result = await loadMessagesPageData(studentCookie, otherConversationId);
  assert.equal(result.ok, true, 'список диалогов грузится — ошибка только в панели чужого диалога');
  if (!result.ok) return;
  assert.equal(result.value.active?.ok, false, 'чужой диалог не отдаётся');
  const html = render(<MessagesView result={result} />);
  assert.match(html, /data-testid="conversation-error"/, 'объяснение вместо чужих сообщений');
  assert.equal(html.includes('Чужая переписка'), false, 'содержимое чужого диалога не утекает');
});

test('сотруднику деканата переписка объяснена и предложен его раздел', async () => {
  const result = await loadMessagesPageData(staffCookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mode, 'none');
  const html = render(<MessagesView result={result} />);
  assert.match(html, /Раздел для студентов и преподавателей/);
  assert.match(html, /href="\/staff"/, 'путь в кабинет деканата');
});

// ---------------------------------------------------------------------------
// Оболочки кабинета сотрудника и переписки
// ---------------------------------------------------------------------------

test('оболочка сотрудника: баннер концепта, шесть разделов, цели ≥ 44 px', () => {
  const html = renderShellAtPath('/staff/requests', <p>контент</p>);

  assert.match(html, /Учебный концепт для конкурса\. Не официальный сервис УдГУ\./, 'баннер кейса');
  assert.match(html, /aria-label="Разделы кабинета деканата"/, 'навигация с доступным именем');
  for (const label of ['Сводка', 'Заявки', 'Билеты', 'Болезни', 'Анонсы', 'Пары']) {
    assert.ok(html.includes(label), `раздел «${label}» в нижней навигации`);
  }
  assert.match(html, /min-h-14/, 'пункты навигации — 56 px (≥ 44)');
  assert.match(html, /aria-current="page"/, 'активный раздел помечен aria-current');
  assert.ok(
    /<a [^>]*href="\/staff\/requests"[^>]*>/.test(html) &&
      (html.match(/<a [^>]*href="\/staff\/requests"[^>]*>/)?.[0] ?? '').includes('aria-current="page"'),
    'aria-current ровно на разделе «Заявки»',
  );
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, 'активен только один раздел');
  assert.match(html, /aria-label="Верификация студбилетов"/, 'короткая подпись + полное доступное имя');
});

test('оболочка переписки: у студента и преподавателя своя навигация', () => {
  const studentShell = render(
    <PathnameContext.Provider value="/messages">
      <MessagesShell mode="student" teacherId={null}>
        <p>контент</p>
      </MessagesShell>
    </PathnameContext.Provider>,
  );
  assert.match(studentShell, /href="\/"/, 'студенту доступен личный кабинет');
  assert.match(studentShell, /href="\/teachers"/, 'студенту доступен справочник преподавателей');
  assert.ok(
    (studentShell.match(/<a [^>]*href="\/messages"[^>]*>/)?.[0] ?? '').includes('aria-current="page"'),
    'переписка — активный раздел студента',
  );

  const teacherShell = render(
    <PathnameContext.Provider value="/messages">
      <MessagesShell mode="teacher" teacherId="teacher-id">
        <p>контент</p>
      </MessagesShell>
    </PathnameContext.Provider>,
  );
  assert.match(teacherShell, /href="\/teachers\/teacher-id"/, 'преподавателю доступно его расписание');
  assert.match(teacherShell, /Моё расписание/);
  assert.match(teacherShell, /Перейти к содержимому/, 'skip-link есть у обеих оболочек');
});

// ---------------------------------------------------------------------------
// Мобильный вид 360 px и доступность новых экранов
// ---------------------------------------------------------------------------

/** Собирает HTML всех новых экранов для проверки вёрстки и доступности. */
async function collectNewScreens(): Promise<readonly string[]> {
  const screens: string[] = [];

  const dashboard = await loadStaffDashboardPageData(staffCookie);
  if (dashboard.ok) screens.push(render(<StaffDashboardView result={dashboard} />));

  const requests = await loadStaffRequestsPageData(staffCookie, undefined);
  if (requests.ok) screens.push(render(<StaffRequestsView result={requests} />));

  const verifications = await loadStaffVerificationsPageData(staffCookie, undefined);
  if (verifications.ok) screens.push(render(<StaffVerificationsView result={verifications} />));

  const sickLeaves = await loadStaffSickLeavesPageData(staffCookie, false);
  if (sickLeaves.ok) screens.push(render(<StaffSickLeavesView result={sickLeaves} />));

  const announcements = await loadStaffAnnouncementsPageData(staffCookie);
  if (announcements.ok) screens.push(render(<StaffAnnouncementsView result={announcements} />));

  const schedule = await loadStaffSchedulePageData(staffCookie, undefined, undefined);
  if (schedule.ok) screens.push(render(<StaffScheduleView result={schedule} />));

  const messagesStudent = await loadMessagesPageData(studentCookie, ownConversationId);
  if (messagesStudent.ok) screens.push(render(<MessagesView result={messagesStudent} />));

  const messagesTeacher = await loadMessagesPageData(teacherCookie, ownConversationId);
  if (messagesTeacher.ok) screens.push(render(<MessagesView result={messagesTeacher} />));

  const messagesGate = await loadMessagesPageData(unverifiedCookie, undefined);
  screens.push(render(<MessagesView result={messagesGate} />));

  screens.push(renderShellAtPath('/staff', <p>контент</p>));
  screens.push(
    render(
      <MessagesShell mode="student" teacherId={null}>
        <p>контент</p>
      </MessagesShell>,
    ),
  );

  return screens;
}

test('мобильный вид: у новых экранов нет фиксированных ширин больше 360 px', async () => {
  const screens = await collectNewScreens();
  assert.ok(screens.length >= 11, `проверяем все новые экраны (${screens.length})`);

  const fixedWidth = /(?:^|[\s"'])(?:min-)?w-\[(\d+)px\]/g;
  const inlineWidth = /width:\s*(\d+)px/g;

  for (const [index, html] of screens.entries()) {
    for (const match of html.matchAll(fixedWidth)) {
      assert.ok(Number(match[1]) <= 360, `экран ${index}: фиксированная ширина ${match[1]}px > 360px`);
    }
    for (const match of html.matchAll(inlineWidth)) {
      assert.ok(Number(match[1]) <= 360, `экран ${index}: инлайн-ширина ${match[1]}px > 360px`);
    }
  }

  const shell = screens[screens.length - 2] ?? '';
  assert.match(shell, /overflow-x-hidden/, 'оболочка сотрудника скрывает горизонтальное переполнение');
});

test('доступность: у интерактивных элементов новых экранов есть видимый фокус', async () => {
  const screens = await collectNewScreens();
  const interactive = /<(a|button|input|select|textarea)\s([^>]*)>/g;
  const missing: string[] = [];

  for (const [index, html] of screens.entries()) {
    for (const [, tag, attributes] of html.matchAll(interactive)) {
      if (attributes.includes('skip-link')) {
        continue;
      }
      if (!attributes.includes('focus-visible')) {
        missing.push(`экран ${index}: <${tag} ${attributes.slice(0, 80)}…>`);
      }
    }
  }

  assert.deepEqual(missing, [], 'интерактивные элементы без видимого focus-visible (WCAG 2.4.7)');
});

test('доступность: декоративные SVG скрыты от скринридера', async () => {
  const screens = await collectNewScreens();
  const unnamedIcons: string[] = [];

  for (const [index, html] of screens.entries()) {
    for (const [, attributes] of html.matchAll(/<svg\s([^>]*)>/g)) {
      if (!attributes.includes('aria-hidden') && !attributes.includes('role="img"')) {
        unnamedIcons.push(`экран ${index}: <svg ${attributes.slice(0, 80)}…>`);
      }
    }
  }

  assert.deepEqual(unnamedIcons, [], 'SVG без aria-hidden и без role="img"');
});

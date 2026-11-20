/**
 * ТЕСТЫ СТРАНИЦ КАБИНЕТА (P1.4b): каждая страница реально рендерится
 * из реальных данных и показывает требуемые состояния.
 *
 * Подход: серверные загрузчики (lib/page-data.ts) вызываются с НАСТОЯЩЕЙ
 * cookie сессии против тестовой БД — это тот же путь, что и у страниц
 * (cookie → validateSession → сервисы packages/core). Виды рендерятся
 * через renderToStaticMarkup и проверяются по содержимому: заголовки,
 * статусы, гейт верификации, пустые состояния.
 *
 * Проверяем:
 * - все экраны кабинета рендерятся без ошибки;
 * - гейт верификации: /grades неверифицированного показывает заглушку
 *   с призывом верифицировать (а не 500 и не пустую страницу);
 * - /staff и /admin для студента → 404 (middleware, требование кейса);
 * - мобильный вид: в разметке нет фиксированных ширин больше 360 px.
 *
 * tsx компилирует JSX классическим рантаймом (React.createElement),
 * поэтому React выставляется глобально ДО импорта компонентов.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { dateKey } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import { createSession } from '@udgu/core';
import middleware from '../middleware';
import { formatDuration } from '../components/format';
import {
  closeWebTestDb,
  createGrade,
  createGroup,
  createNotification,
  createRequest,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createUser,
  createVerification,
  resetWebTestData,
  utcDay,
} from './helpers';

(globalThis as unknown as { React: typeof React }).React = React;

// Виды и загрузчики импортируются после установки глобального React.
const { DashboardView } = await import('../app/(cabinet)/dashboard-screen');
const { ScheduleView } = await import('../app/(cabinet)/schedule/schedule-screen');
const { GradesView } = await import('../app/(cabinet)/grades/grades-screen');
const { RequestsView } = await import('../app/(cabinet)/requests/requests-screen');
const { NotificationsView } = await import('../app/(cabinet)/notifications/notifications-screen');
const { AnnouncementsView } = await import('../app/(cabinet)/announcements/announcements-screen');
const { ProfileView } = await import('../app/(cabinet)/profile/profile-screen');
const { VerificationView } = await import('../app/(cabinet)/verification/verification-screen');
const { SickLeaveView } = await import('../app/(cabinet)/sick-leave/sick-leave-screen');
const { TeachersView } = await import('../app/(cabinet)/teachers/teachers-screen');
const { TeacherCardView } = await import('../app/(cabinet)/teachers/[id]/teacher-card-screen');
const { CabinetShell } = await import('../components/CabinetShell');
const { AssistantView } = await import('../app/(cabinet)/assistant/assistant-screen');
const AuthLayout = (await import('../app/(auth)/layout')).default;
const {
  loadAnnouncementsPageData,
  loadDashboardData,
  loadGradesPageData,
  loadNotificationsPageData,
  loadProfilePageData,
  loadRequestsPageData,
  loadSchedulePageData,
  loadSickLeavePageData,
  loadTeacherCardData,
  loadTeachersPageData,
  loadVerificationPageData,
  loadAssistantPageData,
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

/**
 * Рендер оболочки с заданным путём: CabinetShell берёт путь из
 * usePathname (PathnameContext) — без провайдера он null, и проверить
 * aria-current активного раздела было бы нельзя.
 */
function renderShellAtPath(pathname: string, children: React.ReactNode): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={ROUTER_CONTEXT}>
      <PathnameContext.Provider value={pathname}>
        <CabinetShell>{children}</CabinetShell>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

/**
 * Тег <a …>, у которого есть все перечисленные атрибуты. Порядок атрибутов
 * в разметке Next не гарантирован, поэтому ищем по вхождению, а не порядком.
 */
function anchorTag(html: string, ...attributes: readonly string[]): string | null {
  for (const match of html.matchAll(/<a [^>]*>/g)) {
    const tag = match[0];
    if (attributes.every((attribute) => tag.includes(attribute))) {
      return tag;
    }
  }
  return null;
}

let verifiedCookie: string;
let unverifiedCookie: string;
let rejectedCookie: string;
let teacherId: string;

const TODAY = dateKey(new Date());
const TOMORROW = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
const DAY_AFTER = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('ПИ-31');
  const teacher = await createTeacher('teacher1', { lastName: 'Преподавателев', position: 'доцент' });
  teacherId = teacher.teacherId;
  const subject = await createSubject('TEST-01', 'Тестирование интерфейсов');
  const subject2 = await createSubject('TEST-02', 'Базы данных');

  // Расписание группы: две пары сегодня (с окном между ними), пара завтра.
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '10:00',
    endTime: '11:20',
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject2,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '13:30',
    endTime: '14:50',
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: TOMORROW,
    startTime: '08:30',
    endTime: '09:50',
  });
  // Перенос и отмена — заметные бейджи (требование кейса).
  await getPrisma().scheduleEntry.create({
    data: {
      groupId: group.id,
      subjectId: subject2,
      teacherId: teacher.teacherId,
      date: utcDay(TOMORROW),
      startTime: '10:00',
      endTime: '11:20',
      room: 'У-202',
      type: 'SEMINAR',
      status: 'MOVED',
      note: 'Перенос согласован с кафедрой',
      movedToDate: utcDay(DAY_AFTER),
      movedToRoom: 'Л-305',
    },
  });
  await getPrisma().scheduleEntry.create({
    data: {
      groupId: group.id,
      subjectId: subject,
      teacherId: teacher.teacherId,
      date: utcDay(DAY_AFTER),
      startTime: '13:30',
      endTime: '14:50',
      room: 'У-311',
      type: 'LECTURE',
      status: 'CANCELLED',
      note: 'Отменено: преподаватель на научной конференции',
    },
  });

  // Часы приёма преподавателя (BRIEF v2).
  await getPrisma().officeHour.create({
    data: {
      teacherId: teacher.teacherId,
      weekday: 3,
      startTime: '14:00',
      endTime: '15:30',
      room: 'У-418',
      type: 'RECEPTION',
      note: 'Приём по курсовым работам',
    },
  });

  // Студенты: верифицированный, без заявки, с отказом.
  const verified = await createStudent('student1', group.id, {
    lastName: 'Иванов',
    firstName: 'Александр',
  });
  const unverified = await createStudent('student2', group.id, {
    lastName: 'Петрова',
    firstName: 'Мария',
  });
  const rejected = await createStudent('student3', group.id, {
    lastName: 'Смирнов',
    firstName: 'Никита',
  });
  await createVerification(verified.studentId, 'VERIFIED');
  // Отказ верификации с причиной: сотрудник решил, что группа на фото чужая.
  await getPrisma().studentVerification.create({
    data: {
      studentId: rejected.studentId,
      status: 'REJECTED',
      idCardPhotoPath: `id-cards/${rejected.studentId}/fixture.jpg`,
      recognizedLastName: 'Смирнов',
      recognizedFirstName: 'Никита',
      recognizedGroupName: 'Группа-фикстура',
      recognizedCardNumber: 'UDGU-TEST-0000',
      matchScore: 0.61,
      reviewComment:
        'На фото указана другая группа — сверка не пройдена. Подайте заявку повторно с актуальным фото студбилета.',
      submittedAt: new Date(),
    },
  });

  // Оценки: два закрытых семестра + текущий с несданной работой.
  await createGrade(verified.studentId, subject, 5, null, 'EXAM', 1);
  await createGrade(verified.studentId, subject, null, true, 'CREDIT', 1);
  await createGrade(verified.studentId, subject2, 4, null, 'COURSEWORK', 2);
  await createGrade(verified.studentId, subject2, null, false, 'CREDIT', 2); // долг
  await createGrade(verified.studentId, subject2, null, null, 'EXAM', 3); // предстоящая

  // Заявки: новая (ваш ход в деканате) и готовая (ваш ход у студента).
  await createRequest(verified.studentId, 'NEW');
  await createRequest(verified.studentId, 'READY');

  // Уведомления: непрочитанное и прочитанное.
  await createNotification(verified.userId, 'Изменение в расписании');
  const readNotification = await getPrisma().notification.create({
    data: {
      userId: verified.userId,
      type: 'SYSTEM',
      title: 'Оценка выставлена',
      body: 'По дисциплине «Базы данных» выставлена оценка.',
      read: true,
      link: '/grades',
    },
    select: { id: true },
  });
  assert.ok(readNotification.id.length > 0);

  // Объявления: закреплённое общее + для института + для группы.
  const staff = await createUser('staff1', 'STAFF');
  await getPrisma().announcement.create({
    data: {
      title: 'Стипендиальный конкурс',
      body: 'Подача документов на повышенную стипендию до 1 декабря.',
      audience: 'ALL',
      pinned: true,
      authorId: staff.id,
    },
  });
  await getPrisma().announcement.create({
    data: {
      title: 'Собрание института',
      body: 'Общее собрание студентов 25 ноября в 17:00.',
      audience: 'FACULTY',
      faculty: 'Институт математики, информационных технологий и физики',
      authorId: staff.id,
    },
  });
  await getPrisma().announcement.create({
    data: {
      title: 'Сдача курсовых',
      body: 'Группа ПИ-31: сдача курсовых до 20 декабря.',
      audience: 'GROUP',
      groupId: group.id,
      authorId: staff.id,
    },
  });

  // Отметка о болезни: активная на сегодня.
  await getPrisma().sickLeave.create({
    data: {
      studentId: verified.studentId,
      dateFrom: utcDay(TODAY),
      dateTo: utcDay(DAY_AFTER),
      reason: 'ОРВИ',
    },
  });

  verifiedCookie = `udgu_session=${(await createSession(verified.userId)).token}`;
  unverifiedCookie = `udgu_session=${(await createSession(unverified.userId)).token}`;
  rejectedCookie = `udgu_session=${(await createSession(rejected.userId)).token}`;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

// ---------------------------------------------------------------------------
// Дашборд «Сегодня»
// ---------------------------------------------------------------------------

test('дашборд: приветствие, ближайшая пара, расписание, окна, заявки, уведомления', async () => {
  const result = await loadDashboardData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<DashboardView result={result} />);

  assert.match(html, /Добр(ый день|ое утро|ый вечер|ой ночи), Александр!/, 'приветствие по имени из профиля');
  assert.match(html, /Ближайшая пара/, 'карточка ближайшей пары');
  assert.match(html, /Тестирование интерфейсов/, 'предмет из расписания');
  assert.match(html, /Расписание на сегодня/, 'секция расписания на сегодня');
  assert.match(html, /Свободные окна/, 'свободные окна между парами (решение Council)');
  assert.match(html, /Заявки/, 'секция заявок');
  assert.match(html, /Изменение в расписании/, 'непрочитанное уведомление');
  assert.match(html, /Стипендиальный конкурс/, 'свежее объявление');
  assert.match(html, /В деканате/, 'метка «чей ход» на заявке');
  // Карточка-ссылка в ассистент (BRIEF v2 §5): раздел находится без подсказок.
  assert.match(html, /href="\/assistant"/, 'карточка-ссылка в ассистент');
  // Stagger первого экрана (волна 1, артефакт §3): единственное место
  // хореографии входа в проекте.
  assert.match(html, /class="stagger-in"/, 'обёртка stagger-in на дашборде');
  // Верифицированный студент не видит заглушку гейта.
  assert.equal(html.includes('data-testid="verification-gate"'), false);
});

test('дашборд неверифицированного: заглушка успеваемости с призывом верифицировать', async () => {
  const result = await loadDashboardData(unverifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<DashboardView result={result} />);

  assert.match(html, /data-testid="verification-gate"/, 'карточка гейта верификации');
  assert.match(html, /Верифицировать студенческий билет/, 'призыв действовать');
  assert.match(html, /Добр(ый день|ое утро|ый вечер|ой ночи), Мария!/, 'профиль доступен и до верификации');
});

test('дашборд: секции обёрнуты в stagger-интервал (волна 1)', async () => {
  const result = await loadDashboardData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<DashboardView result={result} />);

  // Хореография входа живёт в globals.css (.stagger-in + keyframes
  // udgu-rise, только при prefers-reduced-motion: no-preference).
  assert.match(html, /class="stagger-in"/, 'контент дашборда в stagger-обёртке');
});

// ---------------------------------------------------------------------------
// Расписание
// ---------------------------------------------------------------------------

test('расписание «Сегодня»: пары, окна на рельсе, ссылка на преподавателей', async () => {
  const result = await loadSchedulePageData(verifiedCookie, undefined, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<ScheduleView result={result} />);

  assert.match(html, /Пары на сегодня/);
  assert.match(html, /Тестирование интерфейсов/);
  assert.match(html, /Базы данных/);
  assert.match(html, /Лекция/, 'тип занятия словом');
  assert.match(html, /Преподавателев Ольга Игоревна/, 'преподаватель у пары');
  // Окна несёт рельс дня в хронологической позиции (карточка-дубль
  // «Свободные окна» убрана: одна мысль на экран, BRIEF v4).
  assert.match(html, /border-t-2 border-dashed border-border/, 'пунктирный сегмент окна на рельсе');
  assert.match(html, /2 ч 10 мин/, 'длительность окна одной строкой на рельсе');
  assert.match(html, /Расписание преподавателей/, 'ссылка на раздел преподавателей');
});

/** Ряды рельса дня: `<li class="relative …">…</li>` (линия рельса — absolute). */
function railRows(html: string): readonly string[] {
  return [...html.matchAll(/<li class="relative[\s\S]*?<\/li>/g)].map((match) => match[0]);
}

/** Ряд рельса, содержащий подстроку (предмет, чип, длительность). */
function railRow(html: string, contains: string): string {
  const row = railRows(html).find((item) => item.includes(contains));
  assert.ok(row !== undefined, `ряд рельса с «${contains}» не найден`);
  return row ?? '';
}

test('расписание «Сегодня»: рельс дня — текущая пара, окно, «сейчас» в окне и после последней пары', async () => {
  const result = await loadSchedulePageData(verifiedCookie, undefined, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // 13:45 — идёт вторая пара: чип «Сейчас» на ней, маркер-строка не нужна.
  const inside = render(<ScheduleView result={result} now={new Date(Date.UTC(2026, 0, 15, 13, 45))} />);
  assert.match(inside, /absolute left-1 top-2 bottom-2 w-0\.5 bg-border/, 'вертикальная линия рельса');
  const current = railRow(inside, 'Базы данных');
  assert.match(current, /text-on-primary">Сейчас</, 'чип «Сейчас» на текущей паре');
  assert.match(
    current,
    /rounded-full border-2 border-primary bg-primary shadow-\[0_0_0_3px_var\(--udgu-color-primary-soft\)\]/,
    'точка текущей пары залита и с кольцом через токен primary-soft',
  );
  assert.equal((inside.match(/>Сейчас</g) ?? []).length, 1, 'маркер-строки нет, пока идёт пара');
  assert.match(inside, /border-t-2 border-dashed border-border/, 'пунктирный сегмент окна на рельсе');
  assert.match(inside, /2 ч 10 мин/, 'длительность окна одной строкой muted');
  assert.equal(inside.includes('>Далее</'), false, 'будущих пар нет — чипа «Далее» нет');

  // 12:30 — внутри окна между парами: маркер-строка с чипом «Сейчас»
  // стоит между парары, у следующей пары чип «Далее».
  const inGap = render(<ScheduleView result={result} now={new Date(Date.UTC(2026, 0, 15, 12, 30))} />);
  const gapRows = railRows(inGap);
  const marker = gapRows.find((item) => item.includes('>Сейчас</'));
  assert.ok(marker !== undefined, 'маркер «сейчас» в хронологической позиции');
  assert.match(marker ?? '', /text-on-primary">Сейчас</, 'чип маркера в окне — основной');
  const firstIndex = gapRows.findIndex((item) => item.includes('Тестирование интерфейсов'));
  const secondIndex = gapRows.findIndex((item) => item.includes('Базы данных'));
  assert.ok(
    firstIndex < gapRows.indexOf(marker ?? '') && gapRows.indexOf(marker ?? '') < secondIndex,
    'маркер встал между парарами',
  );
  assert.match(railRow(inGap, 'Базы данных'), /text-text-muted">Далее</, 'у следующей пары чип «Далее»');

  // 20:00 — пары закончились: маркер после последней пары с нейтральным чипом.
  const after = render(<ScheduleView result={result} now={new Date(Date.UTC(2026, 0, 15, 20, 0))} />);
  const afterRows = railRows(after);
  const afterMarker = afterRows.find((item) => item.includes('>Сейчас</'));
  assert.ok(afterMarker !== undefined, 'маркер «сейчас» после последней пары');
  assert.match(afterMarker ?? '', /text-text-muted">Сейчас</, 'после последней пары чип нейтральный');
  const lastIndex = afterRows.findIndex((item) => item.includes('Базы данных'));
  assert.ok(
    lastIndex >= 0 && lastIndex < afterRows.indexOf(afterMarker ?? ''),
    'маркер стоит после последней пары',
  );
  assert.equal(after.includes('>Далее</'), false, 'чипа «Далее» после последней пары нет');

  // 09:00 — до первой пары: маркер перед ней, у первой пары чип «Далее».
  const before = render(<ScheduleView result={result} now={new Date(Date.UTC(2026, 0, 15, 9, 0))} />);
  const beforeRows = railRows(before);
  const beforeMarker = beforeRows.find((item) => item.includes('>Сейчас</'));
  assert.ok(beforeMarker !== undefined, 'маркер «сейчас» до первой пары');
  assert.ok(
    beforeRows.indexOf(beforeMarker ?? '') < beforeRows.findIndex((item) => item.includes('Тестирование интерфейсов')),
    'маркер встал перед первой парой',
  );
  assert.match(
    railRow(before, 'Тестирование интерфейсов'),
    /text-text-muted">Далее</,
    'у первой пары чип «Далее»',
  );
});

test('расписание «Сегодня»: рельс дня — отменённая пара не «текущая» и не «далее»', async () => {
  // Отдельная группа: отменённая пара в середине дня. getFreeGaps считает
  // окна по фактическим занятиям и сливает их вокруг отменённой, поэтому
  // серверное окно (2 ч 40 мин) не совпадает с промежутками рельса —
  // подписи рельса обязан брать из промежутков между парарами.
  const group = await createGroup('ПИ-61');
  const teacher = await createTeacher('teacher-rail', { lastName: 'Рельсов' });
  const first = await createSubject('RAIL-01', 'Первая дисциплина');
  const cancelled = await createSubject('RAIL-02', 'Отменённая дисциплина');
  const third = await createSubject('RAIL-03', 'Третья дисциплина');
  await createScheduleEntry({
    groupId: group.id,
    subjectId: first,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '10:00',
    endTime: '11:20',
  });
  await getPrisma().scheduleEntry.create({
    data: {
      groupId: group.id,
      subjectId: cancelled,
      teacherId: teacher.teacherId,
      date: utcDay(TODAY),
      startTime: '12:00',
      endTime: '13:20',
      room: 'У-202',
      type: 'SEMINAR',
      status: 'CANCELLED',
      note: 'Отменено: преподаватель на научной конференции',
    },
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: third,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '14:00',
    endTime: '15:20',
  });
  const student = await createStudent('student-rail', group.id, { lastName: 'Путилов' });
  const cookie = `udgu_session=${(await createSession(student.userId)).token}`;

  const result = await loadSchedulePageData(cookie, undefined, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // 12:30 — внутри слота отменённой пары: «текущей» она не бывает.
  const html = render(<ScheduleView result={result} now={new Date(Date.UTC(2026, 0, 15, 12, 30))} />);
  const cancelledRow = railRow(html, 'Отменённая дисциплина');
  assert.match(cancelledRow, /rounded-full border-2 border-danger/, 'точка отменённой пары — danger');
  assert.match(cancelledRow, /line-through decoration-2/, 'ряд отменённой пары зачёркнут');
  assert.equal(cancelledRow.includes('>Сейчас</'), false, 'у отменённой пары нет чипа «Сейчас»');
  assert.equal(cancelledRow.includes('>Далее</'), false, 'у отменённой пары нет чипа «Далее»');

  // Маркер «сейчас» встал перед отменённой парой (её слот содержит now).
  const rows = railRows(html);
  const marker = rows.find((item) => item.includes('>Сейчас</'));
  assert.ok(marker !== undefined, 'маркер «сейчас» на рельсе');
  assert.ok(
    rows.indexOf(marker ?? '') < rows.findIndex((item) => item.includes('Отменённая дисциплина')),
    'маркер встал перед отменённой парой',
  );

  // «Далее» — у следующей реальной пары.
  assert.match(railRow(html, 'Третья дисциплина'), /text-text-muted">Далее</, '«Далее» у следующей реальной пары');

  // Окна рельса — по промежуткам между парарами (40 и 40 мин), а не по
  // слитому окну сервиса: рельс не показывает окно, не совпадающее с
  // расстоянием между парами.
  assert.equal((html.match(/>40 мин</g) ?? []).length, 2, 'два окна рельса по 40 мин');
});

test('расписание «Сегодня»: длительность каждого окна на экране ровно один раз', async () => {
  // Регрессия на дубль: раньше карточка «Свободные окна» повторяла под
  // рельсом те же длительности (одна мысль на экран, BRIEF v4). Окна
  // несёт только рельс — в хронологической позиции, без потери минут:
  // getFreeGaps считает окна только между занятиями дня.
  const result = await loadSchedulePageData(verifiedCookie, undefined, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<ScheduleView result={result} />);

  assert.ok(result.value.freeGaps.length > 0, 'у группы сегодня есть свободные окна');
  // Число рядов-окон на рельсе равно числу окон сервиса: ни одного не
  // потеряно и ни одного не продублировано. Сравнение по счёту, а не по
  // подписи, — две разные пары могут иметь равную длительность.
  const gapRows = html.split('class="sr-only">Окно').length - 1;
  assert.equal(
    gapRows,
    result.value.freeGaps.length,
    'окон на рельсе ровно столько, сколько их в дне — без потерь и дублей',
  );
  for (const gap of result.value.freeGaps) {
    const label = formatDuration(gap.durationMinutes);
    assert.equal(
      html.split(`>${label}<`).length - 1,
      1,
      `окно «${label}» встречается на экране ровно один раз — рельс, а не рельс + карточка`,
    );
  }
  assert.equal(html.includes('Свободные окна'), false, 'карточки-дубля «Свободные окна» на экране нет');
});

test('рельс дня: ряд окна читаем скринридером (скрытый префикс «Окно»)', async () => {
  const result = await loadSchedulePageData(verifiedCookie, undefined, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<ScheduleView result={result} now={new Date(Date.UTC(2026, 0, 15, 12, 30))} />);

  const row = railRow(html, '2 ч 10 мин');
  assert.match(row, /class="sr-only">Окно/, 'перед длительностью — скрытый префикс «Окно»');
  assert.match(row, /class="text-xs tabular-nums text-text-muted">2 ч 10 мин</, 'видимая подпись окна без изменений');
});

test('расписание «Неделя»: перенос и отмена заметно оформлены', async () => {
  const result = await loadSchedulePageData(verifiedCookie, 'week', '0');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<ScheduleView result={result} />);

  assert.match(html, /Текущая неделя/, 'подпись текущей недели');
  assert.match(html, /Перенесена/, 'бейдж переноса');
  assert.match(html, /Л-305/, 'новая аудитория перенесённой пары');
  assert.match(html, /Отменена/, 'бейдж отмены');
  assert.match(html, /Отменено: преподаватель на научной конференции/, 'причина отмены текстом');
  assert.match(html, /Занятий нет/, 'пустой день обозначен словом');
});

// ---------------------------------------------------------------------------
// Успеваемость + гейт верификации
// ---------------------------------------------------------------------------

test('успеваемость верифицированного: сводка, средний балл, долги, тренд', async () => {
  const result = await loadGradesPageData(verifiedCookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<GradesView result={result} />);

  assert.match(html, /Как у меня дела/, 'сводка «как у меня дела»');
  assert.match(html, /data-testid="average-score"/, 'средний балл на экране');
  assert.match(html, /5,00/, 'средний балл посчитан (5,00)');
  assert.match(html, /Долги/);
  assert.match(html, /Базы данных/, 'долг по дисциплине назван');
  assert.match(html, /Тренд/);
  assert.match(html, /Что подтянуть/);
  assert.match(html, /Зачтено/, 'зачёт словом, не только цветом');
  assert.match(html, /Оценки ещё нет/, 'предстоящая работа обозначена');
  assert.match(html, /Леверидж/, 'блок «леверидж» (решение Council)');
  assert.match(html, /Целевой средний балл/, 'ползунок цели');
  assert.match(html, /3 семестр/, 'переключатель семестров');
  // Динамика по семестрам (волна 1): серверный SVG, все числа — в
  // aria-label (тултипов и JS нет). 1 семестр — 5,00, 2 семестр — 4,00.
  assert.match(html, /Динамика по семестрам/, 'секция динамики');
  assert.match(
    html,
    /<svg[^>]*role="img"[^>]*aria-label="Средний балл по семестрам: 1 семестр — 5,00; 2 семестр — 4,00"/,
    'диаграмма тренда с числами обоих семестров в aria-label',
  );
});

test('успеваемость: оценки одного семестра — диаграммы динамики нет', async () => {
  // Сравнивать динамику не с чего: секция не рендерится вовсе (не заглушка).
  const group = await createGroup('ПИ-32');
  const student = await createStudent('student4', group.id, { lastName: 'Односеместров' });
  const singleSubject = await createSubject('TEST-03', 'Динамика одного семестра');
  await createVerification(student.studentId, 'VERIFIED');
  await createGrade(student.studentId, singleSubject, 4, null, 'EXAM', 1);
  const cookie = `udgu_session=${(await createSession(student.userId)).token}`;

  const result = await loadGradesPageData(cookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<GradesView result={result} />);

  assert.match(html, /data-testid="grades-summary"/, 'сводка на экране');
  assert.equal(html.includes('Динамика по семестрам'), false, 'секции динамики нет');
  assert.equal(html.includes('Средний балл по семестрам'), false, 'диаграммы нет');
  assert.match(html, /недостаточно данных/, 'текст тренда честно говорит о нехватке данных');
});

test('успеваемость неверифицированного: заглушка гейта, не ошибка', async () => {
  const result = await loadGradesPageData(unverifiedCookie, undefined);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'verification-required');

  const html = render(<GradesView result={result} />);
  assert.match(html, /data-testid="verification-gate"/, 'заглушка вместо данных');
  assert.match(html, /Верифицировать студенческий билет/);
  assert.equal(html.includes('Как у меня дела'), false, 'оценки не утекают до верификации');
});

test('успеваемость: диаграмма динамики — svg с aria-label и числами семестров', async () => {
  const result = await loadGradesPageData(verifiedCookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<GradesView result={result} />);

  assert.match(html, /Динамика по семестрам/, 'секция динамики под сеткой сводки');
  // Скринридер получает все числа диаграммы: семестры и средние баллы
  // (в фикстуре: 1 семестр — экзамен на 5, 2 семестр — курсовая на 4).
  assert.match(
    html,
    /aria-label="Средний балл по семестрам: 1 семестр — 5,00; 2 семестр — 4,00"/,
    'диаграмма озвучивает оба семестра и оба средних балла',
  );
  assert.match(html, /<svg[^>]*role="img"/, 'смысловой SVG с ролью img');
  assert.match(html, /class="bar[^"]*"/, 'столбцы несут класс .bar — рост снизу делает CSS');
});

test('успеваемость: один семестр с оценками — диаграммы нет', async () => {
  // Свежий студент: оценки только за первый семестр — сравнивать нечего.
  const group = await createGroup('ПИ-41');
  const student = await createStudent('student-trend-one', group.id, { lastName: 'Односеместров' });
  const trendSubject = await createSubject('TREND-01', 'Динамика оценений');
  await createVerification(student.studentId, 'VERIFIED');
  await createGrade(student.studentId, trendSubject, 4, null, 'EXAM', 1);
  const cookie = `udgu_session=${(await createSession(student.userId)).token}`;

  const result = await loadGradesPageData(cookie, undefined);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<GradesView result={result} />);

  assert.equal(html.includes('Динамика по семестрам'), false, 'секция динамики не рендерится');
  assert.equal(html.includes('Средний балл по семестрам'), false, 'диаграммы нет');
});

// ---------------------------------------------------------------------------
// Заявки, уведомления, объявления
// ---------------------------------------------------------------------------

test('заявки: статусы, «чей ход», отмена новой заявки', async () => {
  const result = await loadRequestsPageData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<RequestsView result={result} formOpen={false} />);

  assert.match(html, /Новая заявка/, 'кнопка создания');
  assert.match(html, /Новая/, 'статус заявки словом');
  assert.match(html, /Готова/);
  assert.match(html, /В деканате/, 'у новой заявки ход в деканате');
  assert.match(html, /Ваш ход/, 'у готовой заявки ход у студента');
  assert.match(html, /Отменить заявку/, 'отмена доступна для статуса NEW');
});

test('заявки: таймлайн статуса — шаги у NEW и READY, у отказа таймлайна нет', async () => {
  const result = await loadRequestsPageData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<RequestsView result={result} formOpen={false} />);

  // Два таймлайна: у новой и у готовой заявки (отказ — не этап).
  assert.equal((html.match(/<ol aria-label="Статус заявки"/g) ?? []).length, 2, 'таймлайн у движущихся статусов');
  const timeline = html.match(/<ol aria-label="Статус заявки"[\s\S]*?<\/ol>/);
  assert.ok(timeline !== null, 'таймлайн заявки в разметке');
  assert.match(timeline?.[0] ?? '', />Новая</, 'шаг «Новая»');
  assert.match(timeline?.[0] ?? '', />В работе</, 'шаг «В работе»');
  assert.match(timeline?.[0] ?? '', />Готова</, 'шаг «Готова»');
  assert.match(html, /aria-current="step">Новая</, 'у новой заявки текущий шаг «Новая»');
  assert.match(html, /aria-current="step">Готова</, 'у готовой заявки текущий шаг «Готова»');

  // Отказ — исход, а не этап: карточка отказа на экране, таймлайна нет.
  const group = await createGroup('ПИ-51');
  const rejectedStudent = await createStudent('student-rejected', group.id, { lastName: 'Отказов' });
  await createRequest(rejectedStudent.studentId, 'REJECTED');
  const rejectedSession = `udgu_session=${(await createSession(rejectedStudent.userId)).token}`;
  const rejectedResult = await loadRequestsPageData(rejectedSession);
  assert.equal(rejectedResult.ok, true);
  if (!rejectedResult.ok) return;
  const rejectedHtml = render(<RequestsView result={rejectedResult} formOpen={false} />);
  assert.match(rejectedHtml, /Отклонена/, 'карточка отказа на экране');
  assert.equal(
    rejectedHtml.includes('aria-label="Статус заявки"'),
    false,
    'у отказа таймлайна нет в разметке',
  );
});

test('уведомления: непрочитанные, отметка всех, ссылки на разделы', async () => {
  const result = await loadNotificationsPageData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<NotificationsView result={result} />);

  assert.match(html, /Новое/, 'непрочитанное помечено словом');
  assert.match(html, /Оценка выставлена/, 'прочитанное уведомление в ленте');
  assert.match(html, /Отметить все прочитанными/);
  assert.match(html, /href="\/grades"/, 'ссылка на связанный раздел');
});

test('объявления: закреплённые сверху, аудитории указаны', async () => {
  const result = await loadAnnouncementsPageData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<AnnouncementsView result={result} />);

  const pinnedIndex = html.indexOf('Стипендиальный конкурс');
  const instituteIndex = html.indexOf('Собрание института');
  const groupIndex = html.indexOf('Сдача курсовых');
  assert.ok(pinnedIndex >= 0 && instituteIndex > 0 && groupIndex > 0);
  assert.ok(pinnedIndex < instituteIndex && pinnedIndex < groupIndex, 'закреплённое объявление сверху');
  assert.match(html, /Закреплено/);
  assert.match(html, /Для всех/);
  assert.match(html, /Группа · ПИ-31/, 'аудитория «группа» с названием');
});

// ---------------------------------------------------------------------------
// Профиль, верификация, «болею»
// ---------------------------------------------------------------------------

test('профиль: данные студента, статус верификации, выход', async () => {
  const result = await loadProfilePageData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<ProfileView result={result} />);

  assert.match(html, /Иванов Александр Дмитриевич/);
  assert.match(html, /Институт математики, информационных технологий и физики/, 'институт');
  assert.match(html, /09\.03\.03 Прикладная информатика/, 'направление');
  assert.match(html, /Номер зачётки/);
  assert.match(html, /ИА/, 'аватар-инициалы');
  assert.match(html, /Выйти из кабинета/);
});

test('верификация: статусы PENDING, VERIFIED, REJECTED с причиной и формой', async () => {
  const pending = await loadVerificationPageData(unverifiedCookie);
  assert.equal(pending.ok, true);
  if (!pending.ok) return;
  const pendingHtml = render(<VerificationView result={pending} />);
  assert.match(pendingHtml, /Заявка на верификацию/, 'форма доступна без заявки');
  assert.match(pendingHtml, /Зачем это нужно/, 'объяснение смысла верификации');
  assert.match(pendingHtml, /Фото студенческого билета/);

  const verified = await loadVerificationPageData(verifiedCookie);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  const verifiedHtml = render(<VerificationView result={verified} />);
  assert.match(verifiedHtml, /Верифицирован/, 'статус верифицированного');
  assert.match(verifiedHtml, /Открыты успеваемость и переписка/);
  assert.equal(verifiedHtml.includes('Заявка на верификацию'), false, 'форма скрыта после проверки');

  const rejected = await loadVerificationPageData(rejectedCookie);
  assert.equal(rejected.ok, true);
  if (!rejected.ok) return;
  const rejectedHtml = render(<VerificationView result={rejected} />);
  assert.match(rejectedHtml, /Отклонен/, 'статус отказа');
  assert.match(rejectedHtml, /Причина отказа/, 'причина отказа названа');
  assert.match(rejectedHtml, /Заявка на верификацию/, 'после отказа можно подать снова');
});

test('«болею»: активная отметка выделена, история, объяснение видимости', async () => {
  const result = await loadSickLeavePageData(verifiedCookie);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const html = render(<SickLeaveView result={result} />);

  assert.match(html, /Кто видит статус/, 'объяснение: преподаватели и деканат');
  assert.match(html, /Действует/, 'активная отметка словом');
  assert.match(html, /История отметок/);
  assert.match(html, /ОРВИ/, 'причина отображается');
  assert.match(html, /data-testid="sick-now"/, 'баннер «сейчас вы болеющий»');
});

// ---------------------------------------------------------------------------
// Преподаватели
// ---------------------------------------------------------------------------

test('преподаватели: список и карточка с часами приёма', async () => {
  const list = await loadTeachersPageData(verifiedCookie);
  assert.equal(list.ok, true);
  if (!list.ok) return;
  const listHtml = render(<TeachersView result={list} />);
  assert.match(listHtml, /Преподавателев/);
  assert.match(listHtml, /доцент · Кафедра информационных технологий/, 'должность и кафедра');
  assert.match(listHtml, /href="\/teachers\//, 'ссылка на карточку преподавателя');

  const card = await loadTeacherCardData(verifiedCookie, teacherId);
  assert.equal(card.ok, true);
  if (!card.ok) return;
  const cardHtml = render(<TeacherCardView result={card} />);
  assert.match(cardHtml, /Расписание на две недели/);
  assert.match(cardHtml, /Часы приёма и консультации/);
  assert.match(cardHtml, /Час приёма/, 'тип часа приёма словом');
  assert.match(cardHtml, /группа ПИ-31/, 'в расписании преподавателя видна группа');

  const missing = await loadTeacherCardData(verifiedCookie, '00000000-0000-4000-8000-000000000000');
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.kind, 'not-found', 'неизвестный преподаватель → не найдено');
});

// ---------------------------------------------------------------------------
// Экран входа: skip-link и доступная разметка
// ---------------------------------------------------------------------------

test('вход: skip-link первым элементом, баннер концепта, главная область', async () => {
  // Лэйаут (auth) — серверный компонент: вызываем его и рендерим
  // полученное дерево, как это делает Next на /login.
  const element = await AuthLayout({ children: <p>форма входа</p> });
  const html = render(element);

  const skipLinkIndex = html.indexOf('Перейти к содержимому');
  assert.ok(skipLinkIndex >= 0, 'skip-link «Перейти к содержимому» на экране входа');
  assert.ok(skipLinkIndex < html.indexOf('Учебный концепт'), 'skip-link идёт раньше баннера');
  assert.match(html, /<main[^>]*id="main-content"/, '<main> с идентификатором для skip-link');
  assert.match(html, /Учебный концепт для конкурса\. Не официальный сервис УдГУ\./, 'баннер кейса на виду');
});

// ---------------------------------------------------------------------------
// Оболочка кабинета
// ---------------------------------------------------------------------------

test('оболочка: баннер концепта, шесть разделов, цели ≥ 44px', () => {
  const html = render(
    <CabinetShell>
      <p>контент страницы</p>
    </CabinetShell>,
  );

  assert.match(html, /Учебный концепт для конкурса\. Не официальный сервис УдГУ\./, 'баннер кейса');
  assert.match(html, /aria-label="Основная навигация"/, 'навигация с доступным именем');
  for (const label of ['Сегодня', 'Расписание', 'Успеваемость', 'Заявки', 'Уведомления', 'Ассистент']) {
    assert.ok(html.includes(label), `раздел «${label}» в нижней навигации`);
  }
  assert.match(html, /href="\/"/, '«Сегодня» ведёт на корень');
  assert.match(html, /aria-label="Профиль"/, 'кнопка профиля с доступным именем');
  assert.match(html, /Переключить тему/, 'переключатель темы с доступным именем');
  // Touch-targets: min-h-11 (44 px) у пунктов навигации и кнопок шапки.
  assert.match(html, /min-h-14/, 'пункты навигации — 56 px (≥ 44)');
  assert.ok((html.match(/min-h-11/g) ?? []).length >= 2, 'кнопки шапки — 44 px');
});

test('оболочка: доступность — skip-link первым, aria-current, главная область', () => {
  const html = renderShellAtPath('/grades', <p>контент страницы</p>);

  // Skip-link (WCAG 2.4.1): первый интерактивный элемент документа и
  // ведёт на <main>, который существует на экране.
  const skipLinkIndex = html.indexOf('Перейти к содержимому');
  const headerIndex = html.indexOf('<header');
  assert.ok(skipLinkIndex >= 0, 'skip-link «Перейти к содержимому» присутствует');
  assert.ok(skipLinkIndex < headerIndex, 'skip-link идёт раньше шапки — первый фокус-элемент');
  assert.match(html, /href="#main-content"/, 'skip-link ведёт на основное содержимое');
  assert.match(html, /<main[^>]*id="main-content"/, '<main> с идентификатором для skip-link');

  // aria-current="page" — активный раздел обозначен не только цветом.
  const activeLink = anchorTag(html, 'href="/grades"', 'aria-current="page"');
  assert.ok(activeLink !== null, 'активный пункт навигации помечен aria-current="page"');
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, 'aria-current ровно на одном пункте');
  // Остальные пункты aria-current не получают.
  assert.equal(anchorTag(html, 'href="/schedule"', 'aria-current'), null, 'неактивный пункт без aria-current');
  assert.equal(anchorTag(html, 'href="/"', 'aria-current'), null, '«Сегодня» на /grades не активен');
});

test('оболочка: «Сегодня» активно только на корне', () => {
  const root = renderShellAtPath('/', <p>контент</p>);
  assert.ok(
    anchorTag(root, 'href="/"', 'aria-current="page"') !== null,
    'на корне активен «Сегодня»',
  );

  const schedule = renderShellAtPath('/schedule', <p>контент</p>);
  assert.ok(
    anchorTag(schedule, 'href="/schedule"', 'aria-current="page"') !== null,
    'на /schedule активен «Расписание»',
  );
  assert.equal(anchorTag(schedule, 'href="/"', 'aria-current'), null, '«Сегодня» на /schedule не активен');
});

// ---------------------------------------------------------------------------
// Мобильный вид 360 px и гейтинг /staff, /admin
// ---------------------------------------------------------------------------

/** Собирает HTML всех экранов кабинета для проверки мобильной вёрстки. */
async function collectAllScreens(): Promise<readonly string[]> {
  const screens: string[] = [];

  const dashboard = await loadDashboardData(verifiedCookie);
  if (dashboard.ok) screens.push(render(<DashboardView result={dashboard} />));

  const scheduleToday = await loadSchedulePageData(verifiedCookie, undefined, undefined);
  if (scheduleToday.ok) screens.push(render(<ScheduleView result={scheduleToday} />));

  const scheduleWeek = await loadSchedulePageData(verifiedCookie, 'week', '0');
  if (scheduleWeek.ok) screens.push(render(<ScheduleView result={scheduleWeek} />));

  const grades = await loadGradesPageData(verifiedCookie, undefined);
  if (grades.ok) screens.push(render(<GradesView result={grades} />));

  const requests = await loadRequestsPageData(verifiedCookie);
  if (requests.ok) screens.push(render(<RequestsView result={requests} formOpen />));

  const notifications = await loadNotificationsPageData(verifiedCookie);
  if (notifications.ok) screens.push(render(<NotificationsView result={notifications} />));

  const announcements = await loadAnnouncementsPageData(verifiedCookie);
  if (announcements.ok) screens.push(render(<AnnouncementsView result={announcements} />));

  const profile = await loadProfilePageData(verifiedCookie);
  if (profile.ok) screens.push(render(<ProfileView result={profile} />));

  const verification = await loadVerificationPageData(verifiedCookie);
  if (verification.ok) screens.push(render(<VerificationView result={verification} />));

  const sickLeave = await loadSickLeavePageData(verifiedCookie);
  if (sickLeave.ok) screens.push(render(<SickLeaveView result={sickLeave} />));

  const teachers = await loadTeachersPageData(verifiedCookie);
  if (teachers.ok) screens.push(render(<TeachersView result={teachers} />));

  const card = await loadTeacherCardData(verifiedCookie, teacherId);
  if (card.ok) screens.push(render(<TeacherCardView result={card} />));

  const assistant = await loadAssistantPageData(verifiedCookie);
  if (assistant.ok) screens.push(render(<AssistantView result={assistant} />));

  screens.push(
    render(
      <CabinetShell>
        <p>контент</p>
      </CabinetShell>,
    ),
  );

  return screens;
}

test('мобильный вид: нет фиксированных ширин больше 360 px', async () => {
  const screens = await collectAllScreens();
  assert.ok(screens.length >= 14, `проверяем все экраны кабинета (${screens.length})`);

  // Фиксированные ширины в пикселях — единственный источник горизонтального
  // скролла на 360 px: классы w-[Npx], min-w-[Npx] и инлайн style="width: Npx".
  const fixedWidth = /(?:^|[\s"'])(?:min-)?w-\[(\d+)px\]/g;
  const inlineWidth = /width:\s*(\d+)px/g;

  for (const [index, html] of screens.entries()) {
    for (const match of html.matchAll(fixedWidth)) {
      const width = Number(match[1]);
      assert.ok(width <= 360, `экран ${index}: фиксированная ширина ${width}px > 360px`);
    }
    for (const match of html.matchAll(inlineWidth)) {
      const width = Number(match[1]);
      assert.ok(width <= 360, `экран ${index}: инлайн-ширина ${width}px > 360px`);
    }
  }

  // Оболочка прячет горизонтальное переполнение и держит контент в max-w.
  const shell = screens[screens.length - 1] ?? '';
  assert.match(shell, /overflow-x-hidden/, 'оболочка скрывает горизонтальный скролл');
});

test('доступность: у каждого интерактивного элемента есть видимый фокус', async () => {
  const screens = await collectAllScreens();
  const interactive = /<(a|button|input|select|textarea)\s([^>]*)>/g;
  const missing: string[] = [];

  for (const [index, html] of screens.entries()) {
    for (const [, tag, attributes] of html.matchAll(interactive)) {
      // skip-link оформлен в globals.css через :focus-visible — там нет
      // Tailwind-класса, но кольцо фокуса есть.
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

test('доступность: декоративные SVG скрыты от скринридера, иконочные кнопки названы', async () => {
  const screens = await collectAllScreens();
  const unnamedIcons: string[] = [];

  for (const [index, html] of screens.entries()) {
    for (const [, attributes] of html.matchAll(/<svg\s([^>]*)>/g)) {
      // Декоративный SVG — aria-hidden; смысловой (знак концепта) —
      // role="img" + aria-label. Третьего варианта нет.
      if (!attributes.includes('aria-hidden') && !attributes.includes('role="img"')) {
        unnamedIcons.push(`экран ${index}: <svg ${attributes.slice(0, 80)}…>`);
      }
    }
  }

  assert.deepEqual(unnamedIcons, [], 'SVG без aria-hidden и без role="img"');
});

test('/staff и /admin недоступны студенту (404, не 403)', async () => {
  for (const path of ['/staff', '/admin', '/staff/requests', '/admin/users']) {
    const response = await middleware(
      new NextRequest(`http://localhost${path}`, { headers: { cookie: verifiedCookie } }),
    );
    assert.equal(response.status, 404, `${path} для студента — 404`);
    assert.notEqual(response.headers.get('location'), '/login', 'без редиректа: раздел «не существует»');
  }
});

test('страницы кабинета закрыты для анонима (редирект на /login)', async () => {
  for (const path of ['/', '/dashboard', '/schedule', '/grades', '/requests', '/notifications']) {
    const response = await middleware(new NextRequest(`http://localhost${path}`));
    assert.equal(response.status, 307, `${path} без сессии — редирект`);
    assert.equal(response.headers.get('location'), 'http://localhost/login');
  }
});

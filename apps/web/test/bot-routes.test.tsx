/**
 * HTTP-ТЕСТЫ КАНАЛОВ ДОСТУПА (/api/bot/*, страница /channels, BRIEF v3):
 * симулятор ботов Telegram / VK / MAX и проброс уведомлений в каналы.
 *
 * Проверяем ровно то, что проверяет PO (BRIEF v3 «Каналы доступа»):
 *   - аноним → 401 на всех трёх роутах (middleware не открывает /api/bot/*);
 *   - POST без CSRF-токена → 403 (middleware);
 *   - страница /channels закрыта для анонима (редирект на /login);
 *   - /api/bot/message с сессией студента: /help отвечает списком команд;
 *   - channelUserId, поданный в теле, ИГНОРИРУЕТСЯ: идентификатор аккаунта
 *     канала выводится из сессии (demo-<канал>-<userId>) — иначе клиент
 *     назвался бы чужим аккаунтом мессенджера и получил чужой кабинет;
 *   - полный цикл: код привязки → /link → /schedule отвечает расписанием
 *     студента (общий бэкенд: тот же сервис, что и страница /schedule);
 *   - /request создаёт заявку, которую видит getMyRequests того же
 *     пользователя: бот не второй кабинет, а тот же;
 *   - inbox показывает поставленные в outbox доставки и только свои;
 *   - страница /channels рендерится из сессии (серверные загрузчики +
 *     react-dom/server), в навигации оболочки есть седьмой пункт «Каналы»;
 *   - адаптеры каналов: start/stop идемпотентны, токен не утекает ни в лог,
 *     ни в тело сообщения; демо-режим диспетчера закрывает очередь статусом
 *     DEMO (честная пометка, не фейк-доставка).
 *
 * Роуты вызываются напрямую (как staff-routes.test.ts) — это тот же код,
 * что в продакшене.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {
  createSession,
  enqueueChannelDeliveries,
  getMyRequests,
  getMyScheduleToday,
  validateSession,
  type AuthSession,
} from '@udgu/core';
import { getPrisma } from '@udgu/db';
import { POST as linkCodeRoute } from '../app/api/bot/link-code/route';
import { POST as botMessageRoute } from '../app/api/bot/message/route';
import { GET as botInboxRoute } from '../app/api/bot/inbox/route';
import middleware from '../middleware';
import { CabinetShell } from '../components/CabinetShell';
import { ChannelsView } from '../app/(cabinet)/channels/channels-screen';
import { loadChannelsPageData } from '../lib/page-data';
import { demoChannelUserId } from '../lib/bot/demo-channel';
import { runChannelDispatch } from '../lib/bot/dispatcher';
import { TelegramAdapter } from '../lib/bot/adapters';
import {
  closeWebTestDb,
  createGroup,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createVerification,
  resetWebTestData,
  FACULTY_A,
} from './helpers';
import { apiRequest, callRoute, responseJson } from './http';

(globalThis as unknown as { React: typeof React }).React = React;

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
  return render(
    <PathnameContext.Provider value={pathname}>
      <CabinetShell>{children}</CabinetShell>
    </PathnameContext.Provider>,
  );
}

let studentToken: string;
let studentSession: AuthSession;
let otherStudentToken: string;
let studentUserId: string;

function studentCookies(): { udgu_session: string } {
  return { udgu_session: studentToken };
}

/** Ответ роута бота: { replies } — по одному сообщению на ответ ядра. */
async function botMessage(
  cookies: { udgu_session: string },
  body: Record<string, unknown>,
): Promise<{ status: number; replies: readonly string[] }> {
  const response = await callRoute(
    botMessageRoute,
    apiRequest('/api/bot/message', { method: 'POST', body, cookies }),
  );
  const payload = await response.json<{ replies?: readonly string[] }>();
  return { status: response.status(), replies: payload.replies ?? [] };
}

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('БОТ-37', FACULTY_A);
  const subject = await createSubject('БОТ-701', 'Информатика');
  const teacher = await createTeacher('bot-teacher1');
  const student = await createStudent('student1', group.id);
  const otherStudent = await createStudent('student2', group.id);

  // Расписание группы на сегодня: /schedule в боте должен ответить им же.
  const today = new Date().toISOString().slice(0, 10);
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: today,
    startTime: '10:00',
    endTime: '11:20',
    room: 'У-101',
  });
  await createVerification(student.studentId, 'VERIFIED');

  studentUserId = student.userId;
  studentToken = (await createSession(student.userId)).token;
  otherStudentToken = (await createSession(otherStudent.userId)).token;
  studentSession = (await validateSession(studentToken)) as AuthSession;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

// ---------------------------------------------------------------------------
// Гейтинг: аноним и CSRF
// ---------------------------------------------------------------------------

test('аноним → 401 на всех трёх роутах каналов', async () => {
  const message = await callRoute(
    botMessageRoute,
    apiRequest('/api/bot/message', { method: 'POST', body: { channel: 'telegram', text: '/help' } }),
  );
  assert.equal(message.status(), 401);
  assert.equal((await message.json<{ error: { code: string } }>()).error.code, 'UNAUTHENTICATED');

  const linkCode = await callRoute(
    linkCodeRoute,
    apiRequest('/api/bot/link-code', { method: 'POST', body: { channel: 'telegram' } }),
  );
  assert.equal(linkCode.status(), 401);

  const inbox = await callRoute(botInboxRoute, apiRequest('/api/bot/inbox'));
  assert.equal(inbox.status(), 401);
});

test('middleware: POST без CSRF-токена → 403, /channels закрыт для анонима', async () => {
  const noCsrf = await middleware(
    new NextRequest('http://localhost/api/bot/message', {
      method: 'POST',
      headers: { cookie: `udgu_session=${studentToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', text: '/help' }),
    }),
  );
  assert.equal(noCsrf.status, 403);
  assert.equal((await responseJson<{ error: { code: string } }>(noCsrf)).error.code, 'CSRF_INVALID');

  const page = await middleware(new NextRequest('http://localhost/channels'));
  assert.equal(page.status, 307, 'аноним не попадает на /channels');
  assert.equal(page.headers.get('location'), 'http://localhost/login');

  const studentPage = await middleware(
    new NextRequest('http://localhost/channels', { headers: { cookie: `udgu_session=${studentToken}` } }),
  );
  assert.equal(studentPage.status, 200, 'вошедший студент открывает /channels');
});

// ---------------------------------------------------------------------------
// Команды бота из сессии
// ---------------------------------------------------------------------------

test('/api/bot/message: /help отвечает списком команд кабинета', async () => {
  // До привязки канал честно просит привязать аккаунт.
  const before = await botMessage(studentCookies(), { channel: 'telegram', text: '/help' });
  assert.match(before.replies[0] ?? '', /Привяжите аккаунт/);

  // После привязки — те же команды, что и разделы кабинета.
  const codeResponse = await callRoute(
    linkCodeRoute,
    apiRequest('/api/bot/link-code', {
      method: 'POST',
      body: { channel: 'telegram' },
      cookies: studentCookies(),
    }),
  );
  const { code } = await codeResponse.json<{ code: string }>();
  const linked = await botMessage(studentCookies(), { channel: 'telegram', text: `/link ${code}` });
  assert.match(linked.replies[0] ?? '', /привязан/i);

  const after = await botMessage(studentCookies(), { channel: 'telegram', text: '/help' });
  assert.equal(after.status, 200);
  assert.match(after.replies[0] ?? '', /\/schedule/);
  assert.match(after.replies[0] ?? '', /\/request/);
});

test('channelUserId из тела не принимается: идентификатор выводится из сессии', async () => {
  // Код привязки принадлежит student1 — его должен принять только
  // демо-идентификатор student1, а не название из тела запроса.
  const codeResponse = await callRoute(
    linkCodeRoute,
    apiRequest('/api/bot/link-code', {
      method: 'POST',
      body: { channel: 'telegram' },
      cookies: studentCookies(),
    }),
  );
  assert.equal(codeResponse.status(), 200);
  const { code } = await codeResponse.json<{ code: string }>();
  assert.match(code, /^[A-Z0-9]{6}$/, 'код привязки — 6 символов без неоднозначных');

  const linked = await botMessage(studentCookies(), {
    channel: 'telegram',
    text: `/link ${code}`,
    channelUserId: 'demo-telegram-чужой-аккаунт',
  });
  assert.match(linked.replies[0] ?? '', /привязан/i, 'код принят демо-идентификатором сессии');

  // Привязка создана именно для demo-telegram-<userId студента>.
  const own = await getPrisma().oAuthAccount.findUnique({
    where: { providerAccountId: demoChannelUserId('telegram', studentUserId) },
    select: { userId: true, provider: true },
  });
  assert.equal(own?.userId, studentUserId);
  assert.equal(own?.provider, 'TELEGRAM');

  // «Чужой» идентификатор из тела привязкой не стал.
  const foreign = await getPrisma().oAuthAccount.findUnique({
    where: { providerAccountId: 'demo-telegram-чужой-аккаунт' },
    select: { id: true },
  });
  assert.equal(foreign, null, 'идентификатор из тела не создаёт привязку');

  // Код одноразовый: другой студент тем же кодом уже не работает.
  const reused = await botMessage(
    { udgu_session: otherStudentToken },
    { channel: 'telegram', text: `/link ${code}` },
  );
  assert.match(reused.replies[0] ?? '', /недействителен|уже использован/i);
});

test('полный цикл: /link → /schedule отвечает расписанием студента', async () => {
  const codeResponse = await callRoute(
    linkCodeRoute,
    apiRequest('/api/bot/link-code', {
      method: 'POST',
      body: { channel: 'max' },
      cookies: studentCookies(),
    }),
  );
  const { code } = await codeResponse.json<{ code: string }>();
  const linked = await botMessage(studentCookies(), { channel: 'max', text: `/link ${code}` });
  assert.match(linked.replies[0] ?? '', /привязан/i);

  const schedule = await botMessage(studentCookies(), { channel: 'max', text: '/schedule' });
  assert.match(schedule.replies[0] ?? '', /Информатика/, 'расписание своей группы');
  assert.match(schedule.replies[0] ?? '', /10:00/, 'время пары');
  assert.match(schedule.replies[0] ?? '', /У-101/, 'аудитория');

  // Тот же ответ у страницы кабинета: бот вызывает тот же сервис.
  const lessons = await getMyScheduleToday(studentSession);
  assert.ok(lessons.some((lesson) => lesson.subjectName === 'Информатика'));
});

test('/request создаёт заявку в общем бэкенде (видна в getMyRequests)', async () => {
  const response = await botMessage(studentCookies(), {
    channel: 'max',
    text: '/request справка об обучении',
  });
  assert.match(response.replies[0] ?? '', /Справка создана/);

  const requests = await getMyRequests(studentSession);
  const reference = requests.find((request) => request.type === 'REFERENCE');
  assert.ok(reference !== undefined, 'заявка создана тем же сервисом, что и на сайте');
  assert.match(JSON.stringify(reference?.formData ?? {}), /обучении/);
});

// ---------------------------------------------------------------------------
// Inbox уведомлений каналов
// ---------------------------------------------------------------------------

test('inbox показывает поставленные в outbox доставки и только свои', async () => {
  // Уведомление кабинета копией уходит в каналы пользователя: по записи
  // на каждый привязанный канал (telegram + max из тестов выше).
  const items = await enqueueChannelDeliveries(studentUserId, {
    title: 'Пара перенесена',
    body: 'Информатика 18.11 → 19.11, аудитория У-205.',
    link: '/schedule',
  });
  assert.equal(items.length, 2, 'по записи на привязанный канал');

  const own = await callRoute(botInboxRoute, apiRequest('/api/bot/inbox', { cookies: studentCookies() }));
  assert.equal(own.status(), 200);
  const ownBody = await own.json<{
    deliveries: { title: string; body: string; status: string; channel: string | null }[];
  }>();
  const mine = ownBody.deliveries.filter((item) => item.title === 'Пара перенесена');
  assert.equal(mine.length, 2, 'доставки канала видны владельцу');
  assert.ok(
    mine.every((item) => item.channel === 'telegram' || item.channel === 'max'),
    'доставки в каналы этого пользователя',
  );
  assert.ok(mine.every((item) => item.body.endsWith('/schedule')), 'ссылка кабинета в тексте');

  // Соседний студент не видит чужие доставки.
  const foreign = await callRoute(
    botInboxRoute,
    apiRequest('/api/bot/inbox', { cookies: { udgu_session: otherStudentToken } }),
  );
  const foreignBody = await foreign.json<{ deliveries: { title: string }[] }>();
  assert.ok(
    foreignBody.deliveries.every((item) => item.title !== 'Пара перенесена'),
    'чужие доставки не видны',
  );
});

// ---------------------------------------------------------------------------
// Страница /channels
// ---------------------------------------------------------------------------

test('страница /channels рендерится из сессии: табы, пометка демо-режима, inbox', async () => {
  const data = await loadChannelsPageData(`udgu_session=${studentToken}`);
  assert.equal(data.ok, true);
  if (!data.ok) {
    return;
  }
  // Токенов ботов в env нет — все три канала честно помечены демо-режимом.
  assert.deepEqual(data.value.statuses, { telegram: 'demo', vk: 'demo', max: 'demo' });
  // Привязки, сделанные в тестах выше, видны на странице.
  assert.equal(data.value.linked.telegram, true);
  assert.equal(data.value.linked.max, true);
  assert.equal(data.value.linked.vk, false, 'непривязанный канал просит код привязки');
  assert.ok(data.value.inbox.some((item) => item.title === 'Пара перенесена'));

  const html = render(<ChannelsView result={data} />);
  assert.match(html, /Каналы/);
  assert.match(html, /Telegram/);
  assert.match(html, /VK/);
  assert.match(html, /MAX/);
  assert.match(html, /демо-режим/i, 'канал без токена помечен демо-режимом');
  assert.match(html, /Канал привязан/, 'привязанный канал показан как привязанный');
  assert.match(html, /Уведомления в каналах/);
  assert.match(html, /Пара перенесена/, 'inbox уведомлений канала на странице');

  // Первый вход в непривязанный канал: код привязки и кнопка «Привязать».
  const fresh = render(
    <ChannelsView
      result={{ ok: true, value: { ...data.value, linked: { telegram: false, vk: false, max: false } } }}
    />,
  );
  assert.match(fresh, /Привяжите канал/);
  assert.match(fresh, /Получить код/);
});

test('оболочка: седьмой пункт навигации «Каналы» ведёт на /channels', () => {
  const html = renderShellAtPath('/channels', <p>контент</p>);
  assert.match(html, /href="\/channels"/, 'пункт «Каналы» в нижней навигации');
  assert.match(html, /aria-label="Каналы доступа"/, 'полное название в доступном имени');
  assert.match(html, /aria-current="page"/, 'активный пункт отмечен aria-current');
  // Прежние разделы не потерялись: полные названия доступны скринридеру.
  for (const label of ['Сегодня', 'Расписание', 'Успеваемость', 'Заявки', 'Уведомления', 'Ассистент']) {
    assert.ok(html.includes(label), `раздел «${label}» остался в навигации`);
  }
});

// ---------------------------------------------------------------------------
// Адаптеры и диспетчер
// ---------------------------------------------------------------------------

test('адаптер канала: long-polling отвечает ботом, stop гасит цикл, токен не течёт', async () => {
  const sent: { url: string; body: string }[] = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };

  const TOKEN = 'secret-bot-token-value';
  let pollCount = 0;
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const json = (payload: unknown): Response =>
      new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    if (input.includes('/getUpdates')) {
      pollCount += 1;
      // Первый ответ — команда от пользователя, дальше — пусто (и пауза цикла).
      const updates = pollCount === 1 ? [{ update_id: 7, message: { from: { id: 4242 }, text: '/start' } }] : [];
      return json({ ok: true, result: updates });
    }
    sent.push({ url: input, body: String(init?.body ?? '') });
    return json({ ok: true, result: { message_id: 1 } });
  };

  try {
    const adapter = new TelegramAdapter(TOKEN, fetchImpl);
    // Идемпотентность: двойной start не поднимает два цикла опроса.
    adapter.start();
    adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    adapter.stop();
    adapter.stop();
    const pollsAfterStop = pollCount;
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(pollCount, pollsAfterStop, 'после stop новых опросов нет');
    assert.ok(sent.length >= 1, 'ответ ядра отправлен в канал');
    assert.match(sent[0]?.url ?? '', /api\.telegram\.org\/bot/, 'Bot API канала');
    const payload = JSON.parse(sent[0]?.body ?? '{}') as { chat_id: string; text: string };
    assert.equal(payload.chat_id, '4242', 'ответ уходит автору сообщения');
    assert.match(payload.text, /\/help/, 'это ответ ядра на /start');
    // Токен не утекает ни в лог, ни в тело сообщения.
    assert.equal(warnings.length, 0, 'на счастливом пути ошибок в логе нет');
    assert.ok(!payload.text.includes(TOKEN), 'токен не попадает в текст сообщения');
  } finally {
    console.warn = originalWarn;
  }
});

test('адаптер канала: сетевой сбой не роняет процесс (одна строка в лог)', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };

  try {
    const adapter = new TelegramAdapter('token-value', async () => {
      throw new Error('сеть недоступна');
    });
    adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    adapter.stop();
    assert.ok(warnings.length >= 1, 'сбой залогирован');
    assert.match(warnings[0] ?? '', /\[bot:telegram\]/);
    assert.doesNotMatch(warnings[0] ?? '', /token-value/, 'токен не попадает в лог');
  } finally {
    console.warn = originalWarn;
  }
});

test('диспетчер: без токенов очередь закрывается статусом DEMO (честная пометка)', async () => {
  const items = await enqueueChannelDeliveries(studentUserId, {
    title: 'Объявление деканата',
    body: 'Зачёты в среду.',
    link: '/announcements',
  });
  assert.equal(items.length, 2, 'по записи на привязанный канал');

  // Диспетчер разбирает ВСЮ очередь PENDING (в этой базе — записи студента
  // из тестов выше плюс новые).
  const pendingBefore = await getPrisma().channelDelivery.count({ where: { status: 'PENDING' } });
  assert.ok(pendingBefore >= 2);

  const result = await runChannelDispatch();
  assert.equal(result.sent, 0, 'живых адаптеров нет');
  assert.equal(result.demo, pendingBefore, 'все PENDING-записи закрыты как DEMO');
  assert.equal(result.failed, 0);
  assert.equal(result.processed, pendingBefore);

  const rows = await getPrisma().channelDelivery.findMany({
    where: { id: { in: items.map((item) => item.id) } },
  });
  assert.ok(
    rows.every((row) => row.status === 'DEMO' && row.sentAt !== null),
    'ни одна запись не притворяется доставленной',
  );
});

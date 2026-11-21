/**
 * Маршрут и страница AI-ассистента студента (BRIEF v2 §5).
 *
 * Проверяем границу API и рендер экрана:
 * - аноним → 401 (данные ассистента закрыты сессией);
 * - пустой/слишком длинный вопрос → 400 (zod на границе);
 * - студент → 200 с ответом детерминированного движка (в тестах ключа
 *   LLM в env нет — режим deterministic по определению);
 * - неверифицированный студент получает заглушку гейта, а не 500;
 * - экран /assistant рендерится из серверного загрузчика (стартовые
 *   подсказки) — пустое состояние и поле ввода на месте;
 * - лента обменов (волна 4): appendExchange накапливает обмены, пузыри
 *   чата и индикатор «печатает» рендерятся примитивами components/chat.
 *
 * Обработчики вызываются напрямую (test/http.ts): это тот же код, что
 * в продакшене, но без сервера. База — тестовая horizon_test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createSession, dateKey } from '@udgu/core';
import { POST as assistantRoute } from '../app/api/assistant/route';
import {
  closeWebTestDb,
  createGrade,
  createGroup,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createVerification,
  resetWebTestData,
} from './helpers';
import { apiRequest, callRoute } from './http';

(globalThis as unknown as { React: typeof React }).React = React;

// Вид и загрузчик импортируются после установки глобального React.
const { AssistantView } = await import('../app/(cabinet)/assistant/assistant-screen');
const { loadAssistantPageData } = await import('../lib/page-data');
const { CabinetShell } = await import('../components/CabinetShell');
// Примитивы ленты и чистая функция обменов (волна 4 «оживления»).
const { ChatBubble, SourceLinks, TypingIndicator } = await import('../components/chat');
const { appendExchange, AssistantBubble } = await import('../app/(cabinet)/assistant/AssistantPanel');

/** Контекст роутера: клиентский остров вызывает useRouter/usePathname. */
const ROUTER_CONTEXT = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  prefetch: () => Promise.resolve(),
  back: () => {},
  forward: () => {},
} as never;

let sessionToken: string;
let unverifiedToken: string;
/** Группа и предмет фикстуры: нужны тестам расписания на завтра. */
let fixtureGroupId: string;
let fixtureSubjectId: string;

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('АИ-44');
  const teacher = await createTeacher('teacher-assistant');
  const subject = await createSubject('AI-401', 'Машинное обучение');
  fixtureGroupId = group.id;
  fixtureSubjectId = subject;

  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: dateKey(new Date()),
    startTime: '10:00',
    endTime: '11:20',
  });

  const verified = await createStudent('assistant-student', group.id, { lastName: 'Помощников' });
  await createVerification(verified.studentId, 'VERIFIED');
  // Один незачёт (долг) — ответ ассистента должен быть про него.
  await createGrade(verified.studentId, subject, null, false, 'CREDIT', 2);
  await createGrade(verified.studentId, subject, 4, null, 'EXAM', 1);
  sessionToken = (await createSession(verified.userId)).token;

  const unverified = await createStudent('assistant-guest', group.id, { lastName: 'Несверенный' });
  unverifiedToken = (await createSession(unverified.userId)).token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

test('POST /api/assistant: аноним → 401', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', { method: 'POST', body: { question: 'Какие у меня долги?' } }),
  );
  assert.equal(response.status(), 401);
});

test('POST /api/assistant: пустой вопрос → 400', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', { method: 'POST', body: { question: '   ' }, cookies: { udgu_session: sessionToken } }),
  );
  assert.equal(response.status(), 400);
});

test('POST /api/assistant: вопрос длиннее 500 символов → 400', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'а'.repeat(501) },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 400);
});

test('POST /api/assistant: студент → 200 с ответом по его данным', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'Какие у меня долги?' },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    answer: string;
    intent: string;
    suggestions: readonly string[];
    mode: string;
    sources: readonly { label: string; href: string }[];
  }>();
  assert.equal(body.intent, 'DEBTS');
  assert.equal(body.mode, 'deterministic', 'без ключа LLM в env — детерминированный режим');
  assert.match(body.answer, /Долгов: 1/);
  assert.match(body.answer, /Машинное обучение — 2 семестра/);
  // Когда закрывать: свободное окно расписания группы на сегодня.
  assert.match(body.answer, /сегодня|Свободных окон/);
  assert.ok(Array.isArray(body.suggestions));
  assert.ok(body.suggestions.length >= 2 && body.suggestions.length <= 4);
  // Атрибуция (волна 4): из каких разделов кабинета собран ответ.
  assert.deepEqual(body.sources, [
    { label: 'Успеваемость', href: '/grades' },
    { label: 'Расписание', href: '/schedule' },
  ]);
});

test('POST /api/assistant: нераспознанный вопрос → 200 без выдумок', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'Сколько минут в часе?' },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{ answer: string; intent: string; sources: readonly unknown[] }>();
  assert.equal(body.intent, 'UNKNOWN');
  assert.match(body.answer, /Не понял вопрос/);
  assert.doesNotMatch(body.answer, /Машинное обучение/);
  // Ответ не построен на данных кабинета — источников нет.
  assert.deepEqual(body.sources, []);
});

test('POST /api/assistant: неверифицированный студент → заглушка гейта', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'Какой средний балл?' },
      cookies: { udgu_session: unverifiedToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    answer: string;
    intent: string;
    suggestions: readonly string[];
    sources: readonly unknown[];
  }>();
  assert.equal(body.intent, 'AVERAGE');
  assert.equal(body.answer, 'Оценки откроются после верификации студбилета.');
  assert.ok(body.suggestions.includes('Верифицировать билет'));
  // Заглушка гейта не построена на данных кабинета — источников нет.
  assert.deepEqual(body.sources, []);
});

// ---------------------------------------------------------------------------
// Ответы по смыслу (волна 6, «Improve»): «Я болею», расписание, приветствие
// ---------------------------------------------------------------------------

test('POST /api/assistant: «Я болею» → 200 со ссылкой на раздел «Я заболел»', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'Я болею' },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    answer: string;
    intent: string;
    sources: readonly { label: string; href: string }[];
  }>();
  assert.equal(body.intent, 'SICK_LEAVE');
  // Активных больничных у фикстуры нет — ответ ведёт в раздел отметки.
  assert.match(body.answer, /Активных больничных нет/);
  assert.match(body.answer, /Я заболел/);
  assert.ok(
    body.sources.some((source) => source.href === '/sick-leave'),
    'источник ответа — раздел «Я заболел»',
  );
});

test('POST /api/assistant: «расписание на завтра» → 200 с парами на завтра', async () => {
  // Пара на завтра (UTC-даты, как их хранит расписание).
  await createScheduleEntry({
    groupId: fixtureGroupId,
    subjectId: fixtureSubjectId,
    teacherId: (await createTeacher('teacher-tomorrow')).teacherId,
    date: dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    startTime: '12:10',
    endTime: '13:30',
  });

  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'расписание на завтра' },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    answer: string;
    intent: string;
    sources: readonly { label: string; href: string }[];
  }>();
  assert.equal(body.intent, 'SCHEDULE_TODAY');
  assert.match(body.answer, /12:10–13:30 Машинное обучение/);
  assert.ok(
    body.sources.some((source) => source.href === '/schedule'),
    'источник ответа — раздел «Расписание»',
  );
});

test('POST /api/assistant: «привет» → приветствие, источников нет', async () => {
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: 'привет' },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    answer: string;
    intent: string;
    sources: readonly unknown[];
  }>();
  assert.equal(body.intent, 'GREETING');
  assert.match(body.answer, /Здравствуйте/);
  assert.deepEqual(body.sources, [], 'приветствие не строится на данных кабинета');
});

test('POST /api/assistant: XSS-payload в вопросе не отражается в ответе', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const response = await callRoute(
    assistantRoute,
    apiRequest('/api/assistant', {
      method: 'POST',
      body: { question: payload },
      cookies: { udgu_session: sessionToken },
    }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{ answer: string; intent: string }>();
  assert.equal(body.intent, 'UNKNOWN');
  assert.ok(!body.answer.includes(payload), 'ответ не отражает вопрос');
  assert.ok(!body.answer.includes('onerror'), 'ответ не отражает вопрос');
});

test('страница /assistant: рендерится из серверного загрузчика', async () => {
  const cookieHeader = `udgu_session=${sessionToken}`;
  const result = await loadAssistantPageData(cookieHeader);
  assert.equal(result.ok, true);

  // JSX в этом файле не используется (расширение .test.ts) — виды
  // собираются через createElement, как и страницы в pages.test.tsx.
  const html = renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: ROUTER_CONTEXT },
      React.createElement(AssistantView, { result }),
    ),
  );

  assert.match(html, /Ассистент/, 'заголовок раздела');
  assert.match(html, /Вопрос/, 'поле ввода вопроса');
  assert.match(html, /aria-live="polite"/, 'ответ в живой области');
  assert.match(html, /Какие у меня долги\?/, 'стартовые подсказки из загрузчика');
  assert.match(html, /Что ты умеешь\?/, 'стартовая подсказка про возможности');
});

/**
 * Тег <a …>, у которого есть все перечисленные атрибуты. Порядок
 * атрибутов в разметке Next не гарантирован — ищем по вхождению.
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

test('оболочка: «Ассистент» — шестой раздел нижней навигации', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: ROUTER_CONTEXT },
      React.createElement(
        PathnameContext.Provider,
        { value: '/assistant' },
        React.createElement(CabinetShell, null, React.createElement('p', null, 'контент')),
      ),
    ),
  );

  assert.match(html, /href="\/assistant"/, 'пункт «Ассистент» ведёт на раздел');
  assert.match(html, /Ассистент/, 'подпись раздела');
  assert.ok(
    anchorTag(html, 'href="/assistant"', 'aria-current="page"') !== null,
    'активный раздел помечен aria-current="page"',
  );
  assert.ok(
    anchorTag(html, 'href="/grades"', 'aria-current') === null,
    'остальные разделы aria-current не получают',
  );
});

// ---------------------------------------------------------------------------
// Волна 4 «оживления интерфейса» (docs/design/ui-alive-wave-4.html):
// лента обменов — вопрос сразу, индикатор «печатает», источники ответа
// ---------------------------------------------------------------------------

test('appendExchange: два вопроса подряд → два обмена, id уникальны, вопросы по порядку', () => {
  const first = appendExchange([], 'Какие у меня долги?');
  const second = appendExchange(first, 'Расписание на сегодня');

  assert.equal(second.length, 2);
  assert.equal(second[0]?.question, 'Какие у меня долги?');
  assert.equal(second[1]?.question, 'Расписание на сегодня');
  assert.notEqual(second[0]?.id, second[1]?.id, 'идентификаторы обменов уникальны');
  // Новый обмен ещё без ответа: в ленте на его месте индикатор «печатает».
  assert.equal(second[1]?.answer, null);
  assert.equal(second[1]?.error, null);
  // Прежний массив не мутируется: лента растёт копией.
  assert.equal(first.length, 1);
});

test('лента чата: SourceLinks рендерит ссылки-источники (Hit ≥ 24px, без target)', () => {
  const html = renderToStaticMarkup(
    React.createElement(SourceLinks, {
      sources: [
        { label: 'Успеваемость', href: '/grades' },
        { label: 'Расписание', href: '/schedule' },
      ],
    }),
  );

  assert.match(html, /Источники:/);
  const grades = anchorTag(html, 'href="/grades"');
  assert.ok(grades !== null, 'ссылка на раздел «Успеваемость»');
  assert.ok(!(grades ?? '').includes('target='), 'ссылка открывается в том же окне');
  assert.ok(
    anchorTag(html, 'href="/schedule"') !== null,
    'ссылка на раздел «Расписание»',
  );
  assert.match(html, /min-h-6/, 'Hit-area ≥ 24 px (WCAG 2.5.8)');
  assert.match(html, /decoration-dotted/, 'пунктирное подчёркивание ссылки-источника');
});

test('лента чата: пустые источники не рендерятся', () => {
  const html = renderToStaticMarkup(React.createElement(SourceLinks, { sources: [] }));
  assert.equal(html, '', 'у HELP, UNKNOWN и заглушки гейта источников нет');
});

test('лента чата: ChatBubble студента — текст вопроса, рамка primary-soft', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatBubble, { role: 'student', children: 'Какие у меня долги?' }),
  );

  assert.match(html, /Какие у меня долги\?/, 'текст вопроса в пузыре');
  assert.match(html, /bg-primary-soft/, 'пузырь студента на primary-soft');
  assert.match(html, /self-end/, 'пузырь студента прижат вправо');
  assert.match(html, /rounded-br-md/, '«хвост» пузыря справа снизу');
  assert.match(html, /whitespace-pre-line/, 'многострочный ответ сохраняет переносы');
});

test('лента чата: ChatBubble ассистента — слева, на surface', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatBubble, { role: 'assistant', children: 'Долгов: 1' }),
  );

  assert.match(html, /Долгов: 1/);
  assert.match(html, /bg-surface/, 'пузырь ассистента на surface');
  assert.match(html, /self-start/, 'пузырь ассистента прижат влево');
});

test('лента чата: TypingIndicator — статус для скринридера и три точки', () => {
  const html = renderToStaticMarkup(React.createElement(TypingIndicator));

  assert.match(html, /role="status"/);
  assert.match(html, /Ассистент печатает…/, 'скрытый текст статуса');
  assert.match(html, /sr-only/);
  assert.equal((html.match(/typing-dot/g) ?? []).length, 3, 'три точки индикатора');
});

test('лента чата: пузырь ассистента с ответом — бейдж режима и источники', () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantBubble, {
      exchange: {
        id: 'exchange-test-1',
        question: 'Какие у меня долги?',
        answer: 'Долгов: 1',
        mode: 'deterministic',
        sources: [{ label: 'Успеваемость', href: '/grades' }],
        error: null,
      },
      onRetry: () => {},
    }),
  );

  assert.match(html, /Долгов: 1/);
  assert.match(html, /По данным кабинета/, 'бейдж режима ответа');
  assert.match(html, /href="\/grades"/, 'источник под ответом');
});

test('лента чата: пузырь ассистента без ответа — индикатор «печатает», без бейджа', () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantBubble, {
      exchange: {
        id: 'exchange-test-2',
        question: 'Расписание на сегодня',
        answer: null,
        mode: null,
        sources: [],
        error: null,
      },
      onRetry: () => {},
    }),
  );

  assert.match(html, /role="status"/, 'индикатор ожидания в ленте');
  assert.doesNotMatch(html, /По данным кабинета/, 'режим ответа ещё неизвестен');
});

test('лента чата: ошибка обмена — ErrorState с повтором внутри пузыря ассистента', () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantBubble, {
      exchange: {
        id: 'exchange-test-3',
        question: 'Какие у меня долги?',
        answer: null,
        mode: null,
        sources: [],
        error: 'Не удалось получить ответ. Попробуйте снова.',
      },
      onRetry: () => {},
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Не удалось получить ответ/);
  assert.match(html, /Повторить/);
});

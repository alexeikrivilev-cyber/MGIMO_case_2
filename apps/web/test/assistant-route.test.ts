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
 *   подсказки) — пустое состояние и поле ввода на месте.
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

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('АИ-44');
  const teacher = await createTeacher('teacher-assistant');
  const subject = await createSubject('AI-401', 'Машинное обучение');

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
  }>();
  assert.equal(body.intent, 'DEBTS');
  assert.equal(body.mode, 'deterministic', 'без ключа LLM в env — детерминированный режим');
  assert.match(body.answer, /Долгов: 1/);
  assert.match(body.answer, /Машинное обучение — 2 семестра/);
  // Когда закрывать: свободное окно расписания группы на сегодня.
  assert.match(body.answer, /сегодня|Свободных окон/);
  assert.ok(Array.isArray(body.suggestions));
  assert.ok(body.suggestions.length >= 2 && body.suggestions.length <= 4);
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
  const body = await response.json<{ answer: string; intent: string }>();
  assert.equal(body.intent, 'UNKNOWN');
  assert.match(body.answer, /Не понял вопрос/);
  assert.doesNotMatch(body.answer, /Машинное обучение/);
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
  const body = await response.json<{ answer: string; intent: string; suggestions: readonly string[] }>();
  assert.equal(body.intent, 'AVERAGE');
  assert.equal(body.answer, 'Оценки откроются после верификации студбилета.');
  assert.ok(body.suggestions.includes('Верифицировать билет'));
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

/**
 * HTTP-ТЕСТЫ КАБИНЕТА ПРЕПОДАВАТЕЛЯ (/api/teacher/*, BRIEF v2 §5):
 * загрузка учебного плана, список, удаление и RAG-ассистент.
 *
 * Проверяем ровно то, что проверяет PO (ACCEPTANCE, BRIEF §5):
 *   - аноним → 401 (middleware не открывает /api/teacher/*);
 *   - студент и сотрудник деканата без профиля преподавателя → 403;
 *   - преподаватель → 201/200, файл уходит в приватное хранилище
 *     (storage/study-plans/<teacherId>/, вне webroot);
 *   - GET списка не отдаёт storagePath наружу;
 *   - чужой план → 404 (не 403: ответ не отличается от «не существует»);
 *   - zod на пустых полях (название, вопрос) → 400;
 *   - CSRF: POST без токена → 403 (middleware);
 *   - middleware-гейт страниц /teacher/*: аноним → редирект на /login,
 *     студент проходит (лэйаут рисует честную заглушку, не 404);
 *   - страницы /teacher/plans и /teacher/assistant рендерятся из
 *     настоящей сессии (серверные загрузчики + react-dom/server).
 *
 * Роуты вызываются напрямую (как staff-routes.test.ts) — это тот же код,
 * что в продакшне.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createSession } from '@udgu/core';
import { getPrisma } from '@udgu/db';
import {
  GET as studyPlansRoute,
  POST as uploadStudyPlanRoute,
} from '../app/api/teacher/study-plans/route';
import { DELETE as deleteStudyPlanRoute } from '../app/api/teacher/study-plans/[id]/route';
import { POST as teacherAssistantRoute } from '../app/api/teacher/assistant/route';
import middleware from '../middleware';
import {
  closeWebTestDb,
  createGrade,
  createGroup,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createUser,
  createVerification,
  resetWebTestData,
  FACULTY_A,
} from './helpers';
import { apiRequest, callRoute, callRouteWithParams, responseJson } from './http';

(globalThis as unknown as { React: typeof React }).React = React;

const { StudyPlanManager } = await import('../app/(teacher)/teacher/plans/StudyPlanManager');
const { TeacherAssistantPanel } = await import('../app/(teacher)/teacher/assistant/TeacherAssistantPanel');
const { TeacherShell } = await import('../components/TeacherShell');
const { loadTeacherPlansPageData, loadTeacherAssistantPageData } = await import('../lib/page-data');

/** Учебный план преподавателя: разделы с различимыми темами. */
const PLAN_MD = [
  '# Основы программирования',
  '',
  '## 3 модуль: циклы и массивы',
  '',
  'Темы модуля: цикл for, цикл while, вложенные циклы, массивы и сортировка.',
  '',
  '## Лабораторные работы',
  '',
  'Восемь лабораторных работ по циклам и массивам.',
  'Защита — в течение двух недель после выдачи.',
].join('\n');

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

let teacherToken: string;
let otherTeacherToken: string;
let studentToken: string;
let staffToken: string;
let ownPlanId: string;

function teacherCookies(): { udgu_session: string } {
  return { udgu_session: teacherToken };
}

function planFile(content = PLAN_MD, name = 'plan.md', type = 'text/markdown'): File {
  return new File([content], name, { type });
}

function uploadForm(title: string, file: File | null): FormData {
  const form = new FormData();
  form.set('title', title);
  if (file !== null) {
    form.set('file', file);
  }
  return form;
}

test.before(async () => {
  await resetWebTestData();

  const group = await createGroup('ПИ-37', FACULTY_A);
  const subject = await createSubject('ПИ-701', 'Информатика');
  const teacher = await createTeacher('teacher1');
  const otherTeacher = await createTeacher('teacher2');
  const student = await createStudent('student1', group.id);
  const staff = await createUser('staff1', 'STAFF');
  // Сотрудник деканата своего факультета — без профиля преподавателя.
  await getPrisma().user.update({ where: { id: staff.id }, data: { faculty: FACULTY_A } });

  // Преподаватель ведёт пары у группы: её студенты попадают в сопоставление
  // с долгами. У студента есть незачёт.
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: teacher.teacherId,
    date: new Date().toISOString().slice(0, 10),
    startTime: '10:00',
    endTime: '11:20',
  });
  await createGrade(student.studentId, subject, null, false, 'CREDIT', 2);
  await createVerification(student.studentId, 'VERIFIED');

  teacherToken = (await createSession(teacher.userId)).token;
  otherTeacherToken = (await createSession(otherTeacher.userId)).token;
  studentToken = (await createSession(student.userId)).token;
  staffToken = (await createSession(staff.id)).token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

// ---------------------------------------------------------------------------
// Загрузка плана
// ---------------------------------------------------------------------------

test('POST /api/teacher/study-plans: преподаватель → 201, файл в приватном хранилище', async () => {
  const response = await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', {
      method: 'POST',
      formData: uploadForm('Основы программирования', planFile()),
      cookies: teacherCookies(),
    }),
  );
  assert.equal(response.status(), 201);

  const body = await response.json<{
    plan: { id: string; title: string; fileName: string; sizeBytes: number; storagePath?: string };
  }>();
  assert.equal(body.plan.title, 'Основы программирования');
  assert.equal(body.plan.fileName, 'plan.md');
  assert.ok(body.plan.sizeBytes > 0);
  assert.equal(body.plan.storagePath, undefined, 'путь хранилища не отдаётся наружу');
  ownPlanId = body.plan.id;

  // Файл действительно лежит в приватном хранилище (вне webroot).
  const record = await getPrisma().studyPlan.findUniqueOrThrow({ where: { id: ownPlanId } });
  assert.match(record.storagePath, /^study-plans\/[0-9a-f-]+\/[0-9a-f-]{36}\.md$/);
});

test('POST /api/teacher/study-plans: студент и сотрудник → 403, аноним → 401', async () => {
  for (const [token, label, status] of [
    [studentToken, 'студент', 403],
    [staffToken, 'сотрудник деканата', 403],
  ] as const) {
    const response = await callRoute(
      uploadStudyPlanRoute,
      apiRequest('/api/teacher/study-plans', {
        method: 'POST',
        formData: uploadForm('План', planFile()),
        cookies: { udgu_session: token },
      }),
    );
    assert.equal(response.status(), status, `${label} не может загружать планы (${status})`);
    const body = await response.json<{ error: { code: string } }>();
    assert.equal(body.error.code, 'FORBIDDEN');
  }

  const anon = await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', { method: 'POST', formData: uploadForm('План', planFile()) }),
  );
  assert.equal(anon.status(), 401);
});

test('POST /api/teacher/study-plans: пустое название, чужой формат и размер → 400', async () => {
  const emptyTitle = await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', {
      method: 'POST',
      formData: uploadForm('', planFile()),
      cookies: teacherCookies(),
    }),
  );
  assert.equal(emptyTitle.status(), 400);
  assert.equal((await emptyTitle.json<{ error: { code: string } }>()).error.code, 'INVALID_INPUT');

  const wrongFormat = await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', {
      method: 'POST',
      formData: uploadForm('План', new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })),
      cookies: teacherCookies(),
    }),
  );
  assert.equal(wrongFormat.status(), 400);
  assert.match((await wrongFormat.json<{ error: { message: string } }>()).error.message, /\.md|\.txt/);

  const noFile = await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', {
      method: 'POST',
      formData: uploadForm('План', null),
      cookies: teacherCookies(),
    }),
  );
  assert.equal(noFile.status(), 400);

  const tooBig = await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', {
      method: 'POST',
      formData: uploadForm('План', new File([new Uint8Array(1024 * 1024 + 1)], 'big.md', { type: 'text/markdown' })),
      cookies: teacherCookies(),
    }),
  );
  assert.equal(tooBig.status(), 400);
  assert.match((await tooBig.json<{ error: { message: string } }>()).error.message, /1 МБ/);
});

// ---------------------------------------------------------------------------
// Список и удаление
// ---------------------------------------------------------------------------

test('GET /api/teacher/study-plans: свой список без storagePath, чужой — пустой', async () => {
  const own = await callRoute(
    studyPlansRoute,
    apiRequest('/api/teacher/study-plans', { cookies: teacherCookies() }),
  );
  assert.equal(own.status(), 200);
  const ownBody = await own.json<{ plans: { id: string; title: string; storagePath?: string }[] }>();
  assert.equal(ownBody.plans.length, 1);
  assert.equal(ownBody.plans[0]?.id, ownPlanId);
  assert.equal(ownBody.plans[0]?.storagePath, undefined, 'storagePath не уходит в браузер');

  const foreign = await callRoute(
    studyPlansRoute,
    apiRequest('/api/teacher/study-plans', { cookies: { udgu_session: otherTeacherToken } }),
  );
  assert.equal(foreign.status(), 200);
  const foreignBody = await foreign.json<{ plans: unknown[] }>();
  assert.equal(foreignBody.plans.length, 0, 'чужие планы не видны');
});

test('DELETE /api/teacher/study-plans/[id]: чужой → 404, свой → 200', async () => {
  const foreign = await callRouteWithParams(
    deleteStudyPlanRoute,
    apiRequest(`/api/teacher/study-plans/${ownPlanId}`, {
      method: 'DELETE',
      cookies: { udgu_session: otherTeacherToken },
    }),
    { id: ownPlanId },
  );
  assert.equal(foreign.status(), 404, 'чужой план удалить нельзя (404, не 403)');
  assert.equal((await foreign.json<{ error: { code: string } }>()).error.code, 'NOT_FOUND');

  const own = await callRouteWithParams(
    deleteStudyPlanRoute,
    apiRequest(`/api/teacher/study-plans/${ownPlanId}`, { method: 'DELETE', cookies: teacherCookies() }),
    { id: ownPlanId },
  );
  assert.equal(own.status(), 200);

  const again = await callRouteWithParams(
    deleteStudyPlanRoute,
    apiRequest(`/api/teacher/study-plans/${ownPlanId}`, { method: 'DELETE', cookies: teacherCookies() }),
    { id: ownPlanId },
  );
  assert.equal(again.status(), 404, 'повторное удаление — план не найден');
});

// ---------------------------------------------------------------------------
// Ассистент преподавателя
// ---------------------------------------------------------------------------

test('POST /api/teacher/assistant: вопрос по плану → 200 с цитатами', async () => {
  await callRoute(
    uploadStudyPlanRoute,
    apiRequest('/api/teacher/study-plans', {
      method: 'POST',
      formData: uploadForm('Основы программирования', planFile()),
      cookies: teacherCookies(),
    }),
  );

  const response = await callRoute(
    teacherAssistantRoute,
    apiRequest('/api/teacher/assistant', {
      method: 'POST',
      body: { question: 'Что по лабораторным?' },
      cookies: teacherCookies(),
    }),
  );
  assert.equal(response.status(), 200);

  const body = await response.json<{
    answer: string;
    mode: string;
    citations: { section: string; score: number }[];
    suggestions: string[];
    plan: { id: string; title: string } | null;
  }>();
  assert.equal(body.mode, 'deterministic');
  assert.match(body.answer, /Лабораторные работы/);
  assert.ok(body.citations.length >= 1);
  assert.equal(body.citations[0]?.section, 'Лабораторные работы');
  assert.ok((body.citations[0]?.score ?? 0) > 0);
  assert.ok(body.suggestions.length >= 3);
  assert.equal(body.plan?.title, 'Основы программирования');
});

test('POST /api/teacher/assistant: пустой вопрос → 400, чужой план → 404, студент → 403', async () => {
  const empty = await callRoute(
    teacherAssistantRoute,
    apiRequest('/api/teacher/assistant', { method: 'POST', body: { question: '' }, cookies: teacherCookies() }),
  );
  assert.equal(empty.status(), 400);
  assert.equal((await empty.json<{ error: { code: string } }>()).error.code, 'INVALID_INPUT');

  const foreignPlan = await callRoute(
    teacherAssistantRoute,
    apiRequest('/api/teacher/assistant', {
      method: 'POST',
      body: { question: 'Что по лабораторным?', planId: '00000000-0000-4000-8000-000000000000' },
      cookies: teacherCookies(),
    }),
  );
  assert.equal(foreignPlan.status(), 404, 'несуществующий план — тот же ответ, что чужой');

  const asStudent = await callRoute(
    teacherAssistantRoute,
    apiRequest('/api/teacher/assistant', {
      method: 'POST',
      body: { question: 'Что по лабораторным?' },
      cookies: { udgu_session: studentToken },
    }),
  );
  assert.equal(asStudent.status(), 403);

  const anon = await callRoute(
    teacherAssistantRoute,
    apiRequest('/api/teacher/assistant', { method: 'POST', body: { question: 'Что по лабораторным?' } }),
  );
  assert.equal(anon.status(), 401);
});

// ---------------------------------------------------------------------------
// Middleware: CSRF и гейт страниц /teacher/*
// ---------------------------------------------------------------------------

test('middleware: POST без CSRF-токена → 403', async () => {
  const form = new FormData();
  form.set('title', 'План');
  form.set('file', planFile());
  const request = new NextRequest('http://localhost/api/teacher/study-plans', {
    method: 'POST',
    headers: { cookie: `udgu_session=${teacherToken}` },
    body: form,
  });
  const response = await middleware(request);
  assert.equal(response.status, 403);
  assert.equal((await responseJson<{ error: { code: string } }>(response)).error.code, 'CSRF_INVALID');
});

test('middleware: /teacher/* закрыт для анонима, студент проходит (не 404)', async () => {
  const anon = await middleware(new NextRequest('http://localhost/teacher/plans'));
  assert.equal(anon.status, 307);
  assert.equal(anon.headers.get('location'), 'http://localhost/login');

  const anonApi = await middleware(new NextRequest('http://localhost/api/teacher/study-plans'));
  assert.equal(anonApi.status, 401);

  for (const path of ['/teacher/plans', '/teacher/assistant']) {
    const student = await middleware(
      new NextRequest(`http://localhost${path}`, { headers: { cookie: `udgu_session=${studentToken}` } }),
    );
    assert.equal(student.status, 200, `${path} для студента не 404: лэйаут покажет заглушку`);

    const teacher = await middleware(
      new NextRequest(`http://localhost${path}`, { headers: { cookie: `udgu_session=${teacherToken}` } }),
    );
    assert.equal(teacher.status, 200, `${path} для преподавателя открыт`);
  }
});

// ---------------------------------------------------------------------------
// Страницы кабинета преподавателя
// ---------------------------------------------------------------------------

test('страницы: /teacher/plans и /teacher/assistant рендерятся из сессии', async () => {
  const cookie = `udgu_session=${teacherToken}`;

  const plans = await loadTeacherPlansPageData(cookie);
  assert.equal(plans.ok, true);
  if (plans.ok) {
    const html = render(<StudyPlanManager plans={plans.value.plans} />);
    assert.match(html, /Загрузить план/);
    assert.match(html, /Основы программирования/);
  }

  const assistant = await loadTeacherAssistantPageData(cookie);
  assert.equal(assistant.ok, true);
  if (assistant.ok) {
    const html = render(<TeacherAssistantPanel plans={assistant.value.plans} suggestions={assistant.value.suggestions} />);
    assert.match(html, /Какие темы проходят в 3 модуле\?/);
    assert.match(html, /Что по лабораторным\?/);
    assert.match(html, /Где контрольные точки\?/);
  }
});

test('оболочка: три раздела в нижней навигации, активный отмечен', () => {
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={ROUTER_CONTEXT}>
      <PathnameContext.Provider value="/teacher/plans">
        <TeacherShell>
          <p>контент</p>
        </TeacherShell>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
  assert.match(html, /Мои учебные планы/);
  assert.match(html, /Ассистент по учебному плану/);
  assert.match(html, /Переписка со студентами/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /\/messages/);
});

// ---------------------------------------------------------------------------
// Волна 3 «оживления интерфейса» (docs/design/ui-alive-wave-3.html):
// чипы-вопросы ассистента преподавателя дают тот же отклик, что и <Button>
// ---------------------------------------------------------------------------

/** Характерная подстрока PRESS_FEEDBACK (apps/web/lib/ui.ts). */
const PRESS_MARK = 'motion-safe:enabled:active:scale-[0.96]';

test('ассистент преподавателя: волна 3 — чипы вопросов дают отклик на нажатие', async () => {
  const assistant = await loadTeacherAssistantPageData(`udgu_session=${teacherToken}`);
  assert.equal(assistant.ok, true);
  if (!assistant.ok) {
    return;
  }
  const html = render(<TeacherAssistantPanel plans={assistant.value.plans} suggestions={assistant.value.suggestions} />);

  // Чипы — «сырые» <button> (не <Button> из components/ui): без
  // PRESS_FEEDBACK они молчали бы при нажатии, в отличие от «Спросить».
  const buttons = [...html.matchAll(/<button [^>]*>/g)].map((match) => match[0]);
  assert.ok(buttons.length >= 2, `чипы вопросов и кнопка отправки (${buttons.length})`);
  for (const button of buttons) {
    assert.ok(button.includes(PRESS_MARK), `кнопка несёт отклик: ${button.slice(0, 60)}…`);
    assert.ok(!button.includes('transition-colors'), 'transition-colors заменён PRESS_FEEDBACK');
  }
});

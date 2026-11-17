/**
 * ТЕСТЫ AI-АССИСТЕНТА ПРЕПОДАВАТЕЛЯ (BRIEF v2 §5): учебный план в
 * приватном хранилище, детерминированный индекс (TF-IDF по чанкам),
 * поиск релевантных разделов, владение данными и опциональный LLM.
 *
 * Проверяем:
 * - загрузку: свой план → ок; студент и сотрудник без профиля → отказ;
 * - файл уходит в приватное хранилище (storage/study-plans/<teacherId>/),
 *   storagePath наружу не отдаётся;
 * - парсинг плана: заголовки, абзацы, чанки ~500 символов с перекрытием;
 * - retrieve: релевантный чанк выше нерелевантного; вопрос вне плана →
 *   честное «в плане не найдено»;
 * - IDOR: чужой planId → 404-как NOT_OWNER, чужой план в ответе отсутствует;
 * - LLM: инъекция (ответ модели по ЧАНКАМ ВЛАДЕЛЬЦА), фолбэк с пометкой.
 *
 * Хранилище — во временном каталоге (STORAGE_DIR), как в storage.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  askStudyPlanAssistant,
  buildPlanChunks,
  buildStudyPlanIndex,
  deleteStudyPlan,
  listMyStudyPlans,
  parseStudyPlanText,
  parseStudyPlanSections,
  retrieveChunks,
  tokenizePlanText,
  tokensMatch,
  uploadStudyPlan,
  OwnershipError,
  ValidationError,
  type AuthSession,
  type LlmClient,
} from '../src/index.js';
import {
  closeTestDb,
  createGroup,
  createScheduleEntry,
  createStudent,
  createSubject,
  createGrade,
  createTeacher,
  createUser,
  authSessionFor,
  resetTestData,
} from './helpers.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

/** Учебный план преподавателя: три раздела с различимыми темами. */
const PLAN_TEXT = [
  '# Основы программирования',
  '',
  'Курс для первокурсников: от алгоритмов до практики.',
  '',
  '## 3 модуль: циклы и массивы',
  '',
  'Темы модуля: цикл for, цикл while, вложенные циклы, массивы и сортировка.',
  'Контрольная точка 3 — по циклам и массивам, в конце модуля.',
  '',
  '## Лабораторные работы',
  '',
  'Восемь лабораторных работ по циклам, массивам и функциям.',
  'Защита лабораторной работы — в течение двух недель после выдачи.',
  '',
  '## Контрольные точки и зачёт',
  '',
  'Контрольные точки: после 2, 4 и 6 модулей.',
  'Зачёт — по всем контрольным точкам, допуск не ниже 60%.',
  '',
  '## Информатика: зачёт и долги',
  '',
  'Зачёт по информатике выставляется за все лабораторные работы и контрольные точки.',
  'Долги по информатике закрываются до начала сессии.',
].join('\n');

let teacher1: AuthSession;
let teacher2: AuthSession;
let student: AuthSession;
let deanStaff: AuthSession;
let ownPlanId: string;
let foreignPlanId: string;

let storageDir: string;
let previousStorageDir: string | undefined;

/** Мок LLM: фиксированный ответ + запомненный промпт. */
function recordingLlm(reply: string): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async complete({ user }): Promise<string> {
      prompts.push(user);
      return reply;
    },
  };
}

/** Мок LLM, который всегда падает (таймаут/сеть/провайдер). */
const brokenLlm: LlmClient = {
  async complete(): Promise<string> {
    throw new Error('LLM timeout');
  }
};

test.before(async () => {
  previousStorageDir = process.env.STORAGE_DIR;
  storageDir = await mkdtemp(join(tmpdir(), 'udgu-study-plans-'));
  process.env.STORAGE_DIR = storageDir;

  await resetTestData();

  const group = await createGroup('ПИ-31', FACULTY);
  const subject = await createSubject('ПИ-101', 'Информатика');
  const first = await createTeacher('plan-teacher-1');
  const second = await createTeacher('plan-teacher-2');
  const studentFixture = await createStudent('plan-student', group.id);
  const staff = await createUser('plan-staff', 'STAFF');

  // Преподаватель ведёт пары у группы → её студенты попадают в сопоставление
  // с долгами. У студента есть незачёт по информатике.
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId: first.teacherId,
    date: new Date().toISOString().slice(0, 10),
    startTime: '10:00',
    endTime: '11:20',
  });
  await createGrade({
    studentId: studentFixture.studentId,
    subjectId: subject,
    value: null,
    passed: false,
    type: 'CREDIT',
    date: '2026-06-12',
    semester: 2,
  });

  teacher1 = await authSessionFor(first.userId);
  teacher2 = await authSessionFor(second.userId);
  student = await authSessionFor(studentFixture.userId);
  deanStaff = await authSessionFor(staff.id);

  const own = await uploadStudyPlan(teacher1, {
    title: 'Основы программирования',
    fileName: 'plan.md',
    mime: 'text/markdown',
    buffer: Buffer.from(PLAN_TEXT, 'utf8'),
  });
  ownPlanId = own.id;

  // План другого преподавателя — для проверки владения.
  const foreign = await uploadStudyPlan(teacher2, {
    title: 'Чужой план',
    fileName: 'other.md',
    mime: 'text/markdown',
    buffer: Buffer.from('# Чужой план\n\nСекретные темы чужого курса.\n', 'utf8'),
  });
  foreignPlanId = foreign.id;
});

test.after(async () => {
  if (previousStorageDir === undefined) {
    delete process.env.STORAGE_DIR;
  } else {
    process.env.STORAGE_DIR = previousStorageDir;
  }
  await rm(storageDir, { recursive: true, force: true });
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Токенизация и парсинг
// ---------------------------------------------------------------------------

test('токенизация: регистр, ё→е, стоп-слова и односимвольные токены', () => {
  const tokens = tokenizePlanText('Что проходит в 3 модуле? Циклы и ёлочки!');
  assert.deepEqual(tokens.filter((token) => !['проходит', 'модуле', 'циклы', 'елочки'].includes(token)), []);
  // «что», «в», «и» — стоп-слова, «3» — односимвольный токен.
  assert.equal(tokens.includes('что'), false);
  assert.equal(tokens.includes('в'), false);
  assert.equal(tokens.includes('3'), false);
});

test('совпадение токенов: точное, префикс и общий корень', () => {
  assert.equal(tokensMatch('модуль', 'модуль'), true, 'точное совпадение');
  assert.equal(tokensMatch('модуль', 'модуля'), true, 'модуль → модуля');
  assert.equal(tokensMatch('модуле', 'модуль'), true, 'модуле → модуль');
  assert.equal(tokensMatch('лабораторным', 'лабораторные'), true, 'окончание меняется внутри слова');
  assert.equal(tokensMatch('модул', 'модульный'), true, 'вопрос-основа находит форму плана');
  assert.equal(tokensMatch('мо', 'модуль'), false, 'короткое основание не ищется префиксом');
  assert.equal(tokensMatch('тем', 'тема'), false, 'короткий токен плана не участвует в префиксе');
  assert.equal(tokensMatch('экзамен', 'зачет'), false, 'разные корни не совпадают');
});

test('парсинг плана: заголовки, уровни и заголовок плана', () => {
  const parsed = parseStudyPlanText(PLAN_TEXT);
  assert.equal(parsed.title, 'Основы программирования');
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    [
      'Основы программирования',
      '3 модуль: циклы и массивы',
      'Лабораторные работы',
      'Контрольные точки и зачёт',
      'Информатика: зачёт и долги',
    ],
  );
  assert.equal(parsed.sections[0]?.level, 1);
  assert.equal(parsed.sections[1]?.level, 2);
});

test('чанки: ~500 символов, перекрытие по абзацам, заголовок в id', () => {
  const long = ['# Длинный раздел'];
  for (let i = 0; i < 40; i += 1) {
    long.push('', `Абзац ${i}: `.padEnd(60, 'текст ') + String(i));
  }
  const chunks = buildPlanChunks(parseStudyPlanSections(long.join('\n')));
  assert.ok(chunks.length >= 3, `длинный раздел режется на чанки (${chunks.length})`);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 700, `чанк не раздувается: ${chunk.text.length}`);
    assert.equal(chunk.section, 'Длинный раздел');
  }
  // Перекрытие: последний абзац предыдущего чанка начинает новый.
  const lastOfFirst = chunks[0]?.text.split('\n\n').at(-1) ?? '';
  const firstOfSecond = chunks[1]?.text.split('\n\n')[0] ?? '';
  assert.equal(firstOfSecond, lastOfFirst, 'новый чанк начинается с последнего абзаца предыдущего');
});

// ---------------------------------------------------------------------------
// Индекс и поиск
// ---------------------------------------------------------------------------

test('retrieve: релевантный чанк выше нерелевантного', () => {
  const index = buildStudyPlanIndex(buildPlanChunks(parseStudyPlanSections(PLAN_TEXT)));
  const found = retrieveChunks(index, 'Что по лабораторным?', 3);

  assert.ok(found.length >= 1, 'по лабораторным что-то находится');
  assert.equal(found[0]?.chunk.section, 'Лабораторные работы');
  assert.ok((found[0]?.score ?? 0) > 0);

  const cycles = retrieveChunks(index, 'Какие темы проходят в 3 модуле?', 3);
  assert.equal(cycles[0]?.chunk.section, '3 модуль: циклы и массивы', 'модуль находит свой раздел');
  assert.ok(
    (cycles[0]?.score ?? 0) > (cycles.at(-1)?.score ?? 1),
    'первый результат релевантнее последнего',
  );
});

test('retrieve: вопрос вне плана → честный пустой результат', () => {
  const index = buildStudyPlanIndex(buildPlanChunks(parseStudyPlanSections(PLAN_TEXT)));
  assert.deepEqual(retrieveChunks(index, 'Как оформить командировку?', 3), []);
  assert.deepEqual(retrieveChunks(index, '', 3), []);
  assert.deepEqual(retrieveChunks(index, 'что да как', 3), [], 'одни стоп-слова — ничего не найдено');
});

// ---------------------------------------------------------------------------
// Загрузка, список, удаление
// ---------------------------------------------------------------------------

test('загрузка: план сохраняется, список — без storagePath', async () => {
  const plans = await listMyStudyPlans(teacher1);
  assert.equal(plans.length, 1);
  const plan = plans[0];
  assert.equal(plan?.title, 'Основы программирования');
  assert.equal(plan?.fileName, 'plan.md');
  assert.equal(plan?.mime, 'text/markdown');
  assert.ok((plan?.sizeBytes ?? 0) > 0);
  assert.equal('storagePath' in (plan ?? {}), false, 'путь хранилища наружу не отдаётся');
  assert.ok(plan?.uploadedAt instanceof Date);
});

test('загрузка: студент и сотрудник без профиля преподавателя → отказ', async () => {
  for (const [session, label] of [
    [student, 'студент'],
    [deanStaff, 'сотрудник деканата'],
  ] as const) {
    await assert.rejects(
      uploadStudyPlan(session, {
        title: 'План',
        fileName: 'plan.md',
        mime: 'text/markdown',
        buffer: Buffer.from('# План\n\nТекст.\n', 'utf8'),
      }),
      (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_TEACHER',
      `${label} не может загружать планы`,
    );
  }
});

test('загрузка: не тот формат, размер и пустой текст → понятная ошибка', async () => {
  await assert.rejects(
    uploadStudyPlan(teacher1, {
      title: 'План',
      fileName: 'plan.pdf',
      mime: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4', 'utf8'),
    }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
    'PDF не принимается',
  );

  await assert.rejects(
    uploadStudyPlan(teacher1, {
      title: 'План',
      fileName: 'plan.md',
      mime: 'text/markdown',
      buffer: Buffer.alloc(1024 * 1024 + 1, 0x41),
    }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
    'файл больше 1 МБ не принимается',
  );

  await assert.rejects(
    uploadStudyPlan(teacher1, {
      title: 'План',
      fileName: 'plan.md',
      mime: 'text/markdown',
      buffer: Buffer.from('# Только заголовок\n', 'utf8'),
    }),
    (error: unknown) =>
      error instanceof ValidationError && /нет текста/i.test(error.message),
    'план без абзацев отвечать нечем',
  );
});

test('удаление: свой план удаляется, чужой → NOT_OWNER', async () => {
  await assert.rejects(
    deleteStudyPlan(teacher2, ownPlanId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
    'чужой план не удаляется (ответ как для несуществующего)',
  );
  await assert.rejects(
    deleteStudyPlan(teacher2, '00000000-0000-4000-8000-000000000000'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
    'несуществующий план — тот же ответ',
  );

  await deleteStudyPlan(teacher1, ownPlanId);
  const plans = await listMyStudyPlans(teacher1);
  assert.equal(plans.length, 0, 'свой план удалён');
});

// ---------------------------------------------------------------------------
// Ответы ассистента
// ---------------------------------------------------------------------------

test('ответ: цитаты-разделы плана по лабораторным', async () => {
  // План восстановлен: тест удаления его удалил.
  const plan = await uploadStudyPlan(teacher1, {
    title: 'Основы программирования',
    fileName: 'plan.md',
    mime: 'text/markdown',
    buffer: Buffer.from(PLAN_TEXT, 'utf8'),
  });
  ownPlanId = plan.id;

  const answer = await askStudyPlanAssistant(teacher1, { question: 'Что по лабораторным?' });
  assert.equal(answer.mode, 'deterministic');
  assert.equal(answer.plan?.id, plan.id);
  assert.match(answer.answer, /Лабораторные работы/);
  assert.match(answer.answer, /Восемь лабораторных/);
  assert.ok(answer.citations.length >= 1);
  assert.equal(answer.citations[0]?.section, 'Лабораторные работы');
  assert.ok((answer.citations[0]?.score ?? 0) > 0);
});

test('ответ: сопоставление тем плана с долгами студентов', async () => {
  const answer = await askStudyPlanAssistant(teacher1, { question: 'Что по информатике?' });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Информатика: зачёт и долги/);
  // Долг по дисциплине, чей раздел плана найден: сколько и в каких группах.
  assert.match(answer.answer, /Долги по «Информатика»: 1 студент \(ПИ-31\)/);
  assert.match(answer.answer, /раздел «Информатика: зачёт и долги»/);
});

test('ответ: без planId берётся самый свежий план', async () => {
  const older = await uploadStudyPlan(teacher1, {
    title: 'Старый план',
    fileName: 'old.md',
    mime: 'text/markdown',
    buffer: Buffer.from('# Старый план\n\nУстаревшие темы семестра.\n', 'utf8'),
  });
  const newer = await uploadStudyPlan(teacher1, {
    title: 'Свежий план',
    fileName: 'new.md',
    mime: 'text/markdown',
    buffer: Buffer.from('# Свежий план\n\nАктуальные темы семестра.\n', 'utf8'),
  });

  const answer = await askStudyPlanAssistant(teacher1, { question: 'Какие темы семестра?' });
  assert.equal(answer.plan?.id, newer.id, 'без planId отвечает самый свежий план');

  const explicit = await askStudyPlanAssistant(teacher1, {
    question: 'Какие темы семестра?',
    planId: older.id,
  });
  assert.equal(explicit.plan?.id, older.id, 'planId выбирает план явно');

  await deleteStudyPlan(teacher1, older.id);
  await deleteStudyPlan(teacher1, newer.id);
});

test('ответ: вопрос вне плана → честное «в плане не найдено»', async () => {
  const answer = await askStudyPlanAssistant(teacher1, { question: 'Как оформить командировку?' });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /не найден/);
  assert.equal(answer.citations.length, 0, 'цитат нет — врать нечем');
});

// ---------------------------------------------------------------------------
// IDOR и изоляция данных
// ---------------------------------------------------------------------------

test('IDOR: чужой planId → NOT_OWNER (404-как NOT_FOUND)', async () => {
  await assert.rejects(
    askStudyPlanAssistant(teacher1, { question: 'Что по лабораторным?', planId: foreignPlanId }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
    'чужой план не читается даже по прямому идентификатору',
  );

  const foreign = await listMyStudyPlans(teacher2);
  assert.ok(
    foreign.every((plan) => plan.title !== 'Основы программирования'),
    'чужого плана в списке преподавателя нет',
  );
});

test('изоляция: ответ не содержит планы другого преподавателя', async () => {
  const answer = await askStudyPlanAssistant(teacher1, { question: 'Какие темы в плане?' });
  assert.doesNotMatch(answer.answer, /Чужой план/);
  assert.doesNotMatch(answer.answer, /Секретные темы/);

  const own = await listMyStudyPlans(teacher1);
  assert.equal(own.length, 1, 'у преподавателя только свой план');
  assert.equal(own[0]?.id, ownPlanId);
});

// ---------------------------------------------------------------------------
// Опциональный LLM
// ---------------------------------------------------------------------------

test('LLM выключен: ответ всегда детерминированный', async () => {
  const answer = await askStudyPlanAssistant(teacher1, { question: 'Что по лабораторным?' }, { llm: null });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Лабораторные работы/);
});

test('LLM через инъекцию: ответ модели по чанкам владельца', async () => {
  const llm = recordingLlm('По плану: восемь лабораторных, защита в течение двух недель.');
  const answer = await askStudyPlanAssistant(teacher1, { question: 'Что по лабораторным?' }, { llm });

  assert.equal(answer.mode, 'llm');
  assert.match(answer.answer, /восемь лабораторных/);
  // Подсказки берутся у детерминированного движка — диалог продолжается.
  assert.ok(answer.suggestions.length >= 3);
  assert.equal(answer.citations[0]?.section, 'Лабораторные работы', 'цитаты сохранены');

  assert.equal(llm.prompts.length, 1);
  const prompt = llm.prompts[0] ?? '';
  assert.match(prompt, /Что по лабораторным\?/);
  assert.match(prompt, /Лабораторные работы/);
  assert.doesNotMatch(prompt, /Чужой план|Секретные темы/, 'чужих планов в контексте нет');
});

test('LLM бросает ошибку: фолбэк на детерминированный ответ с пометкой', async () => {
  const answer = await askStudyPlanAssistant(teacher1, { question: 'Что по лабораторным?' }, { llm: brokenLlm });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Лабораторные работы/);
  assert.match(answer.answer, /Ответ по плану: ИИ-режим недоступен/);
});

test('без планов: честная подсказка загрузить план', async () => {
  const fresh = await createTeacher('plan-teacher-3');
  const session = await authSessionFor(fresh.userId);
  const answer = await askStudyPlanAssistant(session, { question: 'Что по лабораторным?' });
  assert.equal(answer.mode, 'deterministic');
  assert.equal(answer.plan, null);
  assert.match(answer.answer, /Загрузите учебный план/);
  assert.equal(answer.citations.length, 0);
});

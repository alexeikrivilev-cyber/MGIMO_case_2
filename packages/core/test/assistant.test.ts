/**
 * Тесты AI-ассистента студента (BRIEF v2 §5): детерминированный движок
 * на фикстурах, гейт верификации, план по долгам со свободными окнами и
 * левериджем, изоляция данных и опциональный LLM.
 *
 * Проверяем:
 * - интенты по ключевым словам (русский, регистр и «ё» не важны);
 * - UNKNOWN честно говорит «не понял вопрос» и ничего не выдумывает;
 * - план по долгам содержит долги, свободные окна и леверидж;
 * - целевой балл из вопроса (число 2–5), иначе 4;
 * - неверифицированный студент получает заглушку гейта вместо оценок;
 * - без LLM — mode deterministic; с мок-LMN — ответ модели; ошибка LLM —
 *   фолбэк на движок с пометкой;
 * - вопрос student2 не отдаёт данные student1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askAssistant,
  detectAssistantIntent,
  getMyGrades,
  type AssistantIntent,
  type AuthSession,
  type LlmClient,
} from '../src/index.js';
import {
  addUtcDays,
  dateKey,
  startOfUtcDay,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createSubject,
  createGrade,
  createScheduleEntry,
  createTeacher,
  createVerification,
  authSessionFor,
} from './helpers.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

const TODAY = dateKey(new Date());
const TOMORROW = dateKey(addUtcDays(new Date(), 1));

let student1: AuthSession;
let student2: AuthSession;
let unverified: AuthSession;

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
  },
};

test.before(async () => {
  await resetTestData();

  const group = await createGroup('АСС-22-1', FACULTY);
  const teacher = await createTeacher('teacher-assistant');
  const subjects = {
    math: await createSubject('АСС-101', 'Математический анализ'),
    db: await createSubject('АСС-102', 'Базы данных'),
    web: await createSubject('АСС-103', 'Веб-технологии'),
    art: await createSubject('АСС-104', 'Рисунок'),
    pe: await createSubject('АСС-105', 'Физическая культура'),
    law: await createSubject('АСС-106', 'Правоведение'),
    econ: await createSubject('АСС-201', 'Экономика'),
    hist: await createSubject('АСС-202', 'История'),
  };

  // Расписание группы: сегодня две пары с окном 11:20–13:30,
  // завтра две пары с окном 09:50–11:00.
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subjects.math,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '10:00',
    endTime: '11:20',
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subjects.db,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '13:30',
    endTime: '14:50',
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subjects.web,
    teacherId: teacher.teacherId,
    date: TOMORROW,
    startTime: '08:30',
    endTime: '09:50',
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subjects.pe,
    teacherId: teacher.teacherId,
    date: TOMORROW,
    startTime: '11:00',
    endTime: '12:20',
  });

  // student1: средний балл 3,75 (3+3+4+5), два долга, две предстоящие работы.
  const first = await createStudent('assistant-1', group.id, { lastName: 'Ассистентов' });
  await createGrade({ studentId: first.studentId, subjectId: subjects.math, value: 3, type: 'EXAM', date: '2026-01-12', semester: 1 });
  await createGrade({ studentId: first.studentId, subjectId: subjects.db, value: 3, type: 'EXAM', date: '2026-01-14', semester: 1 });
  await createGrade({ studentId: first.studentId, subjectId: subjects.law, value: 4, type: 'COURSEWORK', date: '2026-01-16', semester: 1 });
  await createGrade({ studentId: first.studentId, subjectId: subjects.art, value: null, passed: false, type: 'CREDIT', date: '2026-01-18', semester: 1 });
  await createGrade({ studentId: first.studentId, subjectId: subjects.web, value: 5, type: 'EXAM', date: '2026-06-10', semester: 2 });
  await createGrade({ studentId: first.studentId, subjectId: subjects.pe, value: null, passed: false, type: 'CREDIT', date: '2026-06-12', semester: 2 });
  // Предстоящие работы текущего семестра (value === null) — для левериджа.
  await createGrade({ studentId: first.studentId, subjectId: subjects.web, value: null, type: 'EXAM', date: '2026-12-18', semester: 3 });
  await createGrade({ studentId: first.studentId, subjectId: subjects.db, value: null, type: 'EXAM', date: '2026-12-20', semester: 3 });
  await createVerification(first.studentId, 'VERIFIED');
  student1 = await authSessionFor(first.userId);

  // student2: другие предметы, долгов нет — для проверки изоляции данных.
  const second = await createStudent('assistant-2', group.id, { lastName: 'Изолированный' });
  await createGrade({ studentId: second.studentId, subjectId: subjects.econ, value: 5, type: 'EXAM', date: '2026-01-12', semester: 1 });
  await createGrade({ studentId: second.studentId, subjectId: subjects.hist, value: 5, type: 'EXAM', date: '2026-01-14', semester: 1 });
  await createVerification(second.studentId, 'VERIFIED');
  student2 = await authSessionFor(second.userId);

  // Без заявки на верификацию — гейт закрыт.
  const third = await createStudent('assistant-3', group.id, { lastName: 'Несверенный' });
  unverified = await authSessionFor(third.userId);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Интенты
// ---------------------------------------------------------------------------

test('интенты: ключевые слова, регистр и «ё» не важны', () => {
  const cases: readonly [string, AssistantIntent][] = [
    ['Какие у меня долги?', 'DEBTS'],
    ['ДОЛГИ', 'DEBTS'],
    ['Незачёт по рисованке', 'DEBTS'],
    ['как закрыть долги?', 'STUDY_PLAN'],
    ['План подготовки к сессии', 'STUDY_PLAN'],
    ['Какой средний балл?', 'AVERAGE'],
    ['Успеваемость', 'AVERAGE'],
    ['Что подтянуть?', 'IMPROVE'],
    ['Расписание на сегодня', 'SCHEDULE_TODAY'],
    ['Какая следующая пара?', 'SCHEDULE_NEXT'],
    ['Ближайшая пара', 'SCHEDULE_NEXT'],
    ['Какие у меня заявки?', 'REQUESTS'],
    ['Когда будет готова справка?', 'REQUESTS'],
    ['Есть новые уведомления?', 'NOTIFICATIONS'],
    ['Новости деканата', 'NOTIFICATIONS'],
    ['Что ты умеешь?', 'HELP'],
    ['Помощь', 'HELP'],
    ['Сколько минут в часе?', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ];
  for (const [question, intent] of cases) {
    assert.equal(detectAssistantIntent(question), intent, `вопрос «${question}»`);
  }
});

test('HELP: список возможностей без обращений к БД', async () => {
  const answer = await askAssistant(student1, 'Что ты умеешь?');
  assert.equal(answer.intent, 'HELP');
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /долги/);
  assert.match(answer.answer, /расписание/);
  assert.ok(answer.suggestions.length >= 2 && answer.suggestions.length <= 4);
});

test('UNKNOWN: честно «не понял вопрос», без выдумок', async () => {
  const answer = await askAssistant(student1, 'Сколько минут в часе?');
  assert.equal(answer.intent, 'UNKNOWN');
  assert.match(answer.answer, /Не понял вопрос/);
  // Никаких данных кабинета в ответе: не поняли — значит не придумываем.
  assert.doesNotMatch(answer.answer, /Математический анализ|Рисунок|средний балл: 3,75/i);
  assert.ok(answer.suggestions.length >= 2 && answer.suggestions.length <= 4);
});

// ---------------------------------------------------------------------------
// Долги и план
// ---------------------------------------------------------------------------

test('DEBTS: долги студента со семестрами', async () => {
  const answer = await askAssistant(student1, 'Какие у меня долги?');
  assert.equal(answer.intent, 'DEBTS');
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Долгов: 2/);
  assert.match(answer.answer, /Рисунок — 1 семестр/);
  assert.match(answer.answer, /Физическая культура — 2 семестра/);
});

test('STUDY_PLAN: план содержит свободные окна и леверидж', async () => {
  const answer = await askAssistant(student1, 'Как закрыть долги?');
  assert.equal(answer.intent, 'STUDY_PLAN');
  // Долги.
  assert.match(answer.answer, /Рисунок — 1 семестр/);
  // Когда закрывать: свободные окна сегодня и завтра (getFreeGaps).
  assert.match(answer.answer, /сегодня 11:20–13:30/);
  assert.match(answer.answer, /завтра 09:50–11:00/);
  // Леверидж: средний 3,75, оценённых 4, предстоящих 2 → цель 4 достижима:
  // нужно 4 × 6 − 15 = 9 баллов, в среднем 4,5 за работу.
  assert.match(answer.answer, /До среднего 4: 9 баллов на 2 предстоящих работах — в среднем 4,5/);
});

test('STUDY_PLAN: целевой балл из вопроса (число 2–5)', async () => {
  const answer = await askAssistant(student1, 'Как поднять средний балл до 5?');
  assert.equal(answer.intent, 'STUDY_PLAN');
  // Цель 5 недостижима: даже все предстоящие на 5 дают (15 + 10) / 6 = 4,17.
  assert.match(answer.answer, /Цель 5 недостижима: максимум 4,17/);
  assert.doesNotMatch(answer.answer, /До среднего 4/);
});

test('AVERAGE: средний балл и тренд', async () => {
  const answer = await askAssistant(student1, 'Какой средний балл?');
  assert.equal(answer.intent, 'AVERAGE');
  assert.match(answer.answer, /Средний балл: 3,75 · оцененных работ: 4/);
});

test('IMPROVE: что подтянуть — долги и низкие оценки', async () => {
  const answer = await askAssistant(student1, 'Что подтянуть?');
  assert.equal(answer.intent, 'IMPROVE');
  assert.match(answer.answer, /Подтянуть: 4 из 4/);
  assert.match(answer.answer, /Рисунок — долг, 1 семестр/);
  assert.match(answer.answer, /Математический анализ — оценка 3, 1 семестр/);
});

// ---------------------------------------------------------------------------
// Расписание, заявки, уведомления — без гейта верификации
// ---------------------------------------------------------------------------

test('SCHEDULE_TODAY: пары своей группы на сегодня', async () => {
  const answer = await askAssistant(student1, 'Расписание на сегодня');
  assert.equal(answer.intent, 'SCHEDULE_TODAY');
  assert.match(answer.answer, /10:00–11:20 Математический анализ · У-101/);
  assert.match(answer.answer, /13:30–14:50 Базы данных · У-101/);
});

test('SCHEDULE_NEXT: ближайшая пара с датой', async () => {
  // Фиксированный момент — 07:00 UTC: сегодняшняя пара ещё впереди.
  const now = new Date(startOfUtcDay(new Date()).getTime() + 7 * 60 * 60 * 1000);
  const answer = await askAssistant(student1, 'Какая следующая пара?', { now });
  assert.equal(answer.intent, 'SCHEDULE_NEXT');
  assert.match(answer.answer, /Следующая пара: сегодня, 10:00–11:20 Математический анализ · У-101/);
});

test('REQUESTS и NOTIFICATIONS: пустые списки без ошибок', async () => {
  const requests = await askAssistant(student1, 'Какие у меня заявки?');
  assert.equal(requests.intent, 'REQUESTS');
  assert.match(requests.answer, /Заявок нет/);

  const notifications = await askAssistant(student1, 'Есть новые уведомления?');
  assert.equal(notifications.intent, 'NOTIFICATIONS');
  assert.match(notifications.answer, /Уведомлений нет/);
});

// ---------------------------------------------------------------------------
// Гейт верификации
// ---------------------------------------------------------------------------

test('гейт: неверифицированный студент получает заглушку вместо оценок', async () => {
  for (const question of ['Какие у меня долги?', 'Как закрыть долги?', 'Какой средний балл?', 'Что подтянуть?']) {
    const answer = await askAssistant(unverified, question);
    assert.equal(answer.answer, 'Оценки откроются после верификации студбилета.', `вопрос «${question}»`);
    assert.equal(answer.mode, 'deterministic');
    assert.ok(
      answer.suggestions.includes('Верифицировать билет'),
      'среди подсказок — действие «Верифицировать билет»',
    );
  }
});

test('гейт: расписание, заявки и уведомления доступны без верификации', async () => {
  const answer = await askAssistant(unverified, 'Расписание на сегодня');
  assert.equal(answer.intent, 'SCHEDULE_TODAY');
  assert.match(answer.answer, /Математический анализ/);
});

test('гейт: даже с LLM оценки неверифицированному не уходят', async () => {
  const llm = recordingLlm('Ответ модели.');
  const answer = await askAssistant(unverified, 'Какие у меня долги?', { llm });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Оценки откроются после верификации/);
  // Модель не вызывалась: контекст с оценками ей не передавали.
  assert.equal(llm.prompts.length, 0);
});

// ---------------------------------------------------------------------------
// Владение данными
// ---------------------------------------------------------------------------

test('изоляция: вопрос student2 не отдаёт данные student1', async () => {
  const answer = await askAssistant(student2, 'Какие у меня долги?');
  assert.equal(answer.intent, 'DEBTS');
  assert.match(answer.answer, /Долгов нет/);
  assert.doesNotMatch(answer.answer, /Рисунок|Физическая культура/);

  const grades = await getMyGrades(student2);
  const subjectNames = grades.semesters.flatMap((semester) => semester.entries.map((entry) => entry.subjectName));
  assert.ok(subjectNames.every((name) => name === 'Экономика' || name === 'История'), 'оценки только student2');
});

// ---------------------------------------------------------------------------
// Опциональный LLM
// ---------------------------------------------------------------------------

test('LLM выключен: ответ всегда детерминированный', async () => {
  const answer = await askAssistant(student1, 'Какие у меня долги?', { llm: null });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Долгов: 2/);
});

test('LLM через инъекцию: ответ модели по контексту владельца', async () => {
  const llm = recordingLlm('Два долга: рисунок и физкультура. Окно сегодня 11:20–13:30.');
  const answer = await askAssistant(student1, 'Какие у меня долги?', { llm });
  assert.equal(answer.mode, 'llm');
  assert.equal(answer.answer, 'Два долга: рисунок и физкультура. Окно сегодня 11:20–13:30.');
  // Подсказки берутся у детерминированного движка — диалог продолжается.
  assert.ok(answer.suggestions.includes('Как закрыть долги?'));
  // В модель ушёл вопрос и сводка ТОЛЬКО владельца сессии.
  assert.equal(llm.prompts.length, 1);
  const prompt = llm.prompts[0] ?? '';
  assert.match(prompt, /Какие у меня долги\?/);
  assert.match(prompt, /Рисунок/);
  assert.doesNotMatch(prompt, /Экономика|История/, 'чужих данных в контексте нет');
});

test('LLM бросает ошибку: фолбэк на детерминированный ответ с пометкой', async () => {
  const answer = await askAssistant(student1, 'Какие у меня долги?', { llm: brokenLlm });
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Долгов: 2/);
  assert.match(answer.answer, /Ответ по данным кабинета: ИИ-режим недоступен/);
});

test('HELP и UNKNOWN не обращаются к LLM', async () => {
  const llm = recordingLlm('Ответ модели.');
  const help = await askAssistant(student1, 'Что ты умеешь?', { llm });
  assert.equal(help.mode, 'deterministic');
  assert.doesNotMatch(help.answer, /Ответ модели/);

  const unknown = await askAssistant(student1, 'Сколько минут в часе?', { llm });
  assert.equal(unknown.mode, 'deterministic');
  assert.equal(llm.prompts.length, 0, 'для HELP и UNKNOWN модель не вызывалась');
});

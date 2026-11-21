/**
 * ТЕСТЫ КАЧЕСТВА ОТВЕТОВ АССИСТЕНТА СТУДЕНТА (волна 6, «Improve»).
 *
 * Дефекты пробного прогона, которые здесь зафиксированы сторожами:
 * - «Я болею» / «Я заболел, не приду на пару» / «Как отметить больничный?»
 *   уходили в UNKNOWN, хотя раздел «Я заболел» в кабинете есть;
 * - «подскажи расписание на завтра» отвечало расписанием СЕГОДНЯ;
 * - «помоги» и «Где моя пара?» уходили в UNKNOWN;
 * - «Какие у меня долги?» тащил за собой леверидж и 10-минутную перемену;
 * - «Привет» получал шаблонное «Не понял вопрос»;
 * - уведомление с пустым title давало пустую строку в ответе.
 *
 * Плюс сторожа контракта: корень 'боле' не используется в ключевых
 * словах SICK_LEAVE (иначе «более 5 баллов» уходило бы в больничный).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  askAssistant,
  detectAssistantIntent,
  type AssistantIntent,
  type AuthSession,
} from '../src/index.js';
import { assistantSourcesFor } from '../src/assistantClient.js';
import { addUtcDays, dateKey } from '../src/index.js';
import {
  closeTestDb,
  createGrade,
  createGroup,
  createNotification,
  createScheduleEntry,
  createSickLeave,
  createStudent,
  createSubject,
  createTeacher,
  createVerification,
  authSessionFor,
  resetTestData,
} from './helpers.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

const TODAY = dateKey(new Date());
const TOMORROW = dateKey(addUtcDays(new Date(), 1));
const DAY_AFTER_TOMORROW = dateKey(addUtcDays(new Date(), 2));

/** Файл движка: сторож ищет ключевые слова SICK_LEAVE прямо в исходнике. */
const ASSISTANT_SOURCE = fileURLToPath(new URL('../src/services/assistant.ts', import.meta.url));

/** Короткие окна: 10-минутная перемена между сменами. */
const SHORT_GAP_MINUTES = 10;

let verified: AuthSession;
let unverified: AuthSession;
let noGaps: AuthSession;
let sickStudent: AuthSession;

test.before(async () => {
  await resetTestData();

  const teacher = await createTeacher('quality-teacher');
  const subjects = {
    math: await createSubject('КЧ-101', 'Математический анализ'),
    db: await createSubject('КЧ-102', 'Базы данных'),
    web: await createSubject('КЧ-103', 'Веб-технологии'),
  };

  // Группа А: сегодня — два окна (10 минут и 90 минут), завтра — только
  // короткое. Послезавтра пар нет вовсе.
  const groupA = await createGroup('КЧ-31', FACULTY);
  await createScheduleEntry({
    groupId: groupA.id,
    subjectId: subjects.math,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '10:00',
    endTime: '11:20',
  });
  await createScheduleEntry({
    groupId: groupA.id,
    subjectId: subjects.db,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '11:30',
    endTime: '12:00',
  });
  await createScheduleEntry({
    groupId: groupA.id,
    subjectId: subjects.web,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '13:30',
    endTime: '14:50',
  });
  await createScheduleEntry({
    groupId: groupA.id,
    subjectId: subjects.math,
    teacherId: teacher.teacherId,
    date: TOMORROW,
    startTime: '10:00',
    endTime: '11:00',
  });
  await createScheduleEntry({
    groupId: groupA.id,
    subjectId: subjects.db,
    teacherId: teacher.teacherId,
    date: TOMORROW,
    startTime: '11:10',
    endTime: '12:00',
  });
  await createScheduleEntry({
    groupId: groupA.id,
    subjectId: subjects.web,
    teacherId: teacher.teacherId,
    date: DAY_AFTER_TOMORROW,
    startTime: '09:00',
    endTime: '10:20',
  });

  // Группа Б: только короткие окна — «свободных окон нет».
  const groupB = await createGroup('КЧ-32', FACULTY);
  await createScheduleEntry({
    groupId: groupB.id,
    subjectId: subjects.math,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '10:00',
    endTime: '11:00',
  });
  await createScheduleEntry({
    groupId: groupB.id,
    subjectId: subjects.db,
    teacherId: teacher.teacherId,
    date: TODAY,
    startTime: '11:10',
    endTime: '12:00',
  });

  const debt = { value: null, passed: false, type: 'CREDIT' as const, date: '2026-06-12', semester: 2 };

  const first = await createStudent('quality-1', groupA.id, { lastName: 'Качественный' });
  await createGrade({ studentId: first.studentId, subjectId: subjects.web, ...debt });
  await createVerification(first.studentId, 'VERIFIED');
  verified = await authSessionFor(first.userId);

  // Без верификации: гейт закрывает оценки, но не больничный.
  const second = await createStudent('quality-2', groupA.id, { lastName: 'Несверенный' });
  unverified = await authSessionFor(second.userId);

  // Активный больничный: сегодня — последний день.
  const third = await createStudent('quality-3', groupA.id, { lastName: 'Больничный' });
  await createSickLeave(third.studentId, dateKey(addUtcDays(new Date(), -2)), TODAY);
  await createVerification(third.studentId, 'VERIFIED');
  sickStudent = await authSessionFor(third.userId);

  const fourth = await createStudent('quality-4', groupB.id, { lastName: 'Безоконный' });
  await createGrade({ studentId: fourth.studentId, subjectId: subjects.db, ...debt });
  await createVerification(fourth.studentId, 'VERIFIED');
  noGaps = await authSessionFor(fourth.userId);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// SICK_LEAVE: новый интент (дефект пробного прогона)
// ---------------------------------------------------------------------------

test('SICK_LEAVE: активный больничный → период и источник «Я заболел»', async () => {
  const answer = await askAssistant(sickStudent, 'Я болею');
  assert.equal(answer.intent, 'SICK_LEAVE');
  assert.equal(answer.mode, 'deterministic');
  assert.match(answer.answer, /Вы на больничном: \d{2}\.\d{2}\.\d{4} — \d{2}\.\d{2}\.\d{4}\./);
  // Ответ ведёт в раздел кабинета, откуда данные.
  assert.deepEqual(answer.sources, [{ label: 'Я заболел', href: '/sick-leave' }]);
  assert.deepEqual(assistantSourcesFor('SICK_LEAVE'), [{ label: 'Я заболел', href: '/sick-leave' }]);
});

test('SICK_LEAVE: «заболел» без отметок → подсказка про раздел', async () => {
  const answer = await askAssistant(verified, 'Я заболел, не приду на пару');
  assert.equal(answer.intent, 'SICK_LEAVE');
  assert.match(answer.answer, /Активных больничных нет\./);
  assert.match(answer.answer, /в разделе «Я заболел»/);
  assert.match(answer.answer, /до 14 дней/);
});

test('SICK_LEAVE: гейт верификации НЕ применяется (больничный не зависит от оценок)', async () => {
  const answer = await askAssistant(unverified, 'Как отметить больничный?');
  assert.equal(answer.intent, 'SICK_LEAVE');
  assert.doesNotMatch(answer.answer, /Оценки откроются после верификации/);
  assert.match(answer.answer, /Активных больничных нет\./);
  assert.deepEqual(answer.sources, [{ label: 'Я заболел', href: '/sick-leave' }]);
});

test('SICK_LEAVE: подсказки — три коротких вопроса', async () => {
  const answer = await askAssistant(verified, 'Я болею');
  assert.deepEqual(answer.suggestions, ['Что ты умеешь?', 'Расписание на сегодня', 'Какие у меня долги?']);
});

// ---------------------------------------------------------------------------
// Смещение дня в SCHEDULE_TODAY (дефект: «на завтра» отдавало сегодня)
// ---------------------------------------------------------------------------

test('SCHEDULE_TODAY: «на завтра» → пары завтра с заголовком «Завтра:»', async () => {
  const answer = await askAssistant(verified, 'подскажи расписание на завтра');
  assert.equal(answer.intent, 'SCHEDULE_TODAY');
  assert.match(answer.answer, /Завтра:/);
  assert.match(answer.answer, /10:00–11:00 Математический анализ · У-101/);
  assert.doesNotMatch(answer.answer, /13:30–14:50/, 'пары сегодня в ответ не попали');
});

test('SCHEDULE_TODAY: «послезавтра» → пары послезавтра с заголовком «Послезавтра:»', async () => {
  const answer = await askAssistant(verified, 'расписание на послезавтра');
  assert.equal(answer.intent, 'SCHEDULE_TODAY');
  assert.match(answer.answer, /Послезавтра:/);
  assert.match(answer.answer, /09:00–10:20 Веб-технологии · У-101/);
  assert.doesNotMatch(answer.answer, /10:00–11:20/, 'пары сегодня в ответ не попали');
});

test('SCHEDULE_TODAY: пустой завтра → «Завтра пар нет.»', async () => {
  const answer = await askAssistant(noGaps, 'расписание на завтра');
  assert.equal(answer.intent, 'SCHEDULE_TODAY');
  assert.equal(answer.answer, 'Завтра пар нет.');
});

test('SCHEDULE_TODAY: без смещения ответ по-прежнему про сегодня', async () => {
  const answer = await askAssistant(verified, 'расписание');
  assert.match(answer.answer, /Сегодня:/);
  assert.match(answer.answer, /10:00–11:20 Математический анализ · У-101/);
});

test('SCHEDULE_TODAY: пустой день послезавтра → «Послезавтра пар нет.»', async () => {
  const answer = await askAssistant(noGaps, 'расписание на послезавтра');
  assert.equal(answer.answer, 'Послезавтра пар нет.');
});

// ---------------------------------------------------------------------------
// gapSlots: короткие окна не показываются
// ---------------------------------------------------------------------------

test('gapSlots: 10-минутная перемена не показывается, 90-минутное окно — показывается', async () => {
  const answer = await askAssistant(verified, 'Какие у меня долги?');
  assert.match(answer.answer, /Когда закрывать: сегодня 12:00–13:30/);
  assert.doesNotMatch(answer.answer, /11:20–11:30/, '10-минутная перемена бесполезна для закрытия долга');
  assert.doesNotMatch(answer.answer, /завтра 11:00–11:10/, 'короткое окно завтра тоже отфильтровано');
});

test('gapSlots: все окна короткие → «Свободных окон нет.»', async () => {
  const answer = await askAssistant(noGaps, 'Какие у меня долги?');
  assert.match(answer.answer, /Долгов: 1/);
  assert.match(answer.answer, /Свободных окон/);
  assert.doesNotMatch(answer.answer, /Когда закрывать/);
});

// ---------------------------------------------------------------------------
// HELP / SCHEDULE / GREETING: дефекты ключевых слов
// ---------------------------------------------------------------------------

test('HELP: «помоги» распознаётся (корень «помощ» его не покрывает)', async () => {
  for (const question of ['помоги', 'Помогите', 'помогать']) {
    assert.equal(detectAssistantIntent(question), 'HELP', `вопрос «${question}»`);
  }
  const answer = await askAssistant(verified, 'помоги');
  assert.equal(answer.intent, 'HELP');
  assert.match(answer.answer, /долги/);
});

test('SCHEDULE_TODAY: «Где моя пара?» — расписание, а не UNKNOWN', async () => {
  assert.equal(detectAssistantIntent('Где моя пара?'), 'SCHEDULE_TODAY');
  const answer = await askAssistant(verified, 'Где моя пара?');
  assert.equal(answer.intent, 'SCHEDULE_TODAY');
  assert.match(answer.answer, /Математический анализ/);
});

test('GREETING: «Привет» → приветствие, источников нет', async () => {
  assert.equal(detectAssistantIntent('Привет'), 'GREETING');
  const answer = await askAssistant(verified, 'Привет');
  assert.equal(answer.intent, 'GREETING');
  assert.match(answer.answer, /Здравствуйте!/);
  assert.doesNotMatch(answer.answer, /Не понял вопрос/);
  assert.deepEqual(answer.sources, []);
  assert.deepEqual(answer.suggestions, ['Какие у меня долги?', 'Расписание на сегодня', 'Какой средний балл?']);
});

// ---------------------------------------------------------------------------
// Побитые данные и XSS
// ---------------------------------------------------------------------------

test('NOTIFICATIONS: уведомление с пустым title не даёт пустой строки', async () => {
  const user = await createStudent('quality-notify', (await createGroup('КЧ-33', FACULTY)).id);
  await createNotification(user.userId, { title: '   ', body: 'Побитая запись без заголовка' });
  await createNotification(user.userId, { title: 'Изменение в расписании' });
  const session = await authSessionFor(user.userId);

  const answer = await askAssistant(session, 'Есть новые уведомления?');
  assert.equal(answer.intent, 'NOTIFICATIONS');
  assert.match(answer.answer, /Непрочитанных: 1/);
  assert.match(answer.answer, /Изменение в расписании/);
  for (const line of answer.answer.split('\n')) {
    assert.notEqual(line.trim(), '', `пустая строка в ответе: ${JSON.stringify(answer.answer)}`);
  }
});

test('XSS-payload в вопросе не отражается в ответе', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const answer = await askAssistant(verified, payload);
  assert.doesNotMatch(answer.answer, /<img|onerror/);
  assert.ok(
    ['UNKNOWN', 'SCHEDULE_TODAY'].includes(answer.intent),
    `интент остаётся обычным: ${answer.intent}`,
  );
  assert.ok((answer.intent as AssistantIntent) !== undefined);
});

// ---------------------------------------------------------------------------
// Сторож контракта: корень 'боле' не используется
// ---------------------------------------------------------------------------

test('сторож: в ключевых словах SICK_LEAVE нет корня «боле»', async () => {
  const source = await readFile(ASSISTANT_SOURCE, 'utf8');
  const line = source
    .split('\n')
    .find((candidate) => candidate.includes("intent: 'SICK_LEAVE'"));
  assert.ok(line !== undefined, 'правило SICK_LEAVE найдено в исходнике');
  // 'боле' матчится в «более»: «более 5 баллов» — про балл, не про больничный.
  assert.doesNotMatch(line ?? '', /'боле'/);
  assert.match(line ?? '', /'болею'/);
  assert.match(line ?? '', /'заболе'/);
  assert.match(line ?? '', /'больнич'/);

  // И то же самое на поведении: вопрос про балл не уходит в больничный.
  for (const question of ['более 5 баллов как поднять', 'хочу более 5 по предмету']) {
    assert.notEqual(detectAssistantIntent(question), 'SICK_LEAVE', `вопрос «${question}»`);
  }
});

test('сторож: окно короче 30 минут не показывается (константа контракта)', async () => {
  const source = await readFile(ASSISTANT_SOURCE, 'utf8');
  assert.match(source, /MIN_GAP_MINUTES_FOR_DEBT = 30/);
  assert.ok(
    source.includes('durationMinutes >= MIN_GAP_MINUTES_FOR_DEBT'),
    'фильтр коротких окон применён до выбора двух самых длинных',
  );
  assert.ok(SHORT_GAP_MINUTES < 30, 'в фикстуре короткое окно действительно короче порога');
});

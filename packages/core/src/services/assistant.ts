/**
 * AI-ассистент СТУДЕНТА (BRIEF v2 §5): помощь в учёбе и закрытие долгов
 * по ДАННЫМ ВЛАДЕЛЬЦА СЕССИИ.
 *
 * Архитектура (решение Hermes):
 * - детерминированный движок — основа. Интент распознаётся по ключевым
 *   словам (русский язык, регистр и «ё» не важны), ответ собирается из
 *   ТЕХ ЖЕ сервисов кабинета, что и страницы (/api/*): getMyAcademicSummary,
 *   getFreeGaps, calculateLeverage, getMyScheduleToday, getMyNextLesson,
 *   getMyRequests, getMyNotifications. SQL не дублируется, studentId
 *   снаружи не принимается ни одним вызовом (правило ownership.ts);
 * - опциональный LLM (llm.ts) только переформулирует готовый ответ по
 *   переданной сводке. Нет ключа в env → режим deterministic; ошибка или
 *   таймаут LLM → ответ детерминированного движка с пометкой;
 * - гейт верификации: интенты, которым нужны оценки (DEBTS, STUDY_PLAN,
 *   AVERAGE, IMPROVE), у неверифицированного студента получают честную
 *   заглушку вместо данных (VerificationRequiredError ловится здесь).
 *   Больничный (SICK_LEAVE) гейтом НЕ закрыт: он не зависит от оценок;
 * - UNKNOWN не выдумывает ответ: честное «не понял вопрос» + подсказки.
 * - sources (assistantSourcesFor в assistantClient.ts): из каких разделов
 *   кабинета собран ответ — атрибуция в интерфейсе (волна 4 «оживления»).
 *
 * Минимализм текста (BRIEF v4): одна мысль на строку, списки — построчно,
 * без абзацев.
 */
import {
  calculateLeverage,
  getMyAcademicSummary,
  getMyGrades,
  type AcademicSummary,
  type LeverageResult,
  type LeverageWork,
} from './grades';
import {
  addUtcDays,
  dayEmptyLessons,
  dayHeading,
  dayOffsetFromQuestion,
  dayWord,
  getFreeGaps,
  getMyNextLesson,
  getMyScheduleToday,
  startOfUtcDay,
  type FreeGap,
  type LessonOccurrence,
  type ScheduleLesson,
} from './schedule';
import { getMyRequests, type MyRequest } from './requests';
import { getMyNotifications, type MyNotification } from './notifications';
import { getMySickLeaves, isSickNow, type MySickLeave } from './sickleave';
import { VerificationRequiredError } from './verification';
import type { AuthSession } from '../session';
import { ASSISTANT_SYSTEM_PROMPT, type LlmClient } from '../llm';
import {
  ASSISTANT_VERIFICATION_SUGGESTION,
  assistantSourcesFor,
  type AssistantSource,
} from '../assistantClient';

// Единый источник для движка и интерфейса: чип-действие гейта верификации.
export { ASSISTANT_VERIFICATION_SUGGESTION };

/** Интенты ассистента: что студент спросил. */
export type AssistantIntent =
  | 'DEBTS'
  | 'STUDY_PLAN'
  | 'AVERAGE'
  | 'IMPROVE'
  | 'SCHEDULE_TODAY'
  | 'SCHEDULE_NEXT'
  | 'SICK_LEAVE'
  | 'REQUESTS'
  | 'NOTIFICATIONS'
  | 'HELP'
  | 'GREETING'
  | 'UNKNOWN';

/** Режим ответа: детерминированный движок или LLM по его данным. */
export type AssistantMode = 'deterministic' | 'llm';

/** Ответ ассистента: текст, интент, follow-up-подсказки, режим и источники. */
export interface AssistantAnswer {
  readonly intent: AssistantIntent;
  readonly answer: string;
  readonly suggestions: readonly string[];
  readonly mode: AssistantMode;
  /** Разделы кабинета, из которых собран ответ (атрибуция, волна 4). */
  readonly sources: readonly AssistantSource[];
}

/** Параметры askAssistant: LLM подключается инъекцией, не глобалом. */
export interface AskAssistantOptions {
  /** Клиент LLM; null/undefined — детерминированный режим. */
  readonly llm?: LlmClient | null;
  /** Текущий момент (для тестов и детерминированности расписания). */
  readonly now?: Date;
}

/** Стартовые вопросы на экране ассистента (пустое состояние и чипы). */
export const ASSISTANT_STARTER_QUESTIONS: readonly string[] = [
  'Какие у меня долги?',
  'Как закрыть долги?',
  'Какой средний балл?',
  'Что подтянуть?',
  'Расписание на сегодня',
  'Что ты умеешь?',
  // Одна новая подсказка: раньше «Я болею» уходило в UNKNOWN, хотя
  // раздел «Я заболел» в кабинете есть.
  'Я болею',
];

/** Интенты, которым нужны оценки: закрыты гейтом верификации. */
const GRADE_INTENTS: readonly AssistantIntent[] = ['DEBTS', 'STUDY_PLAN', 'AVERAGE', 'IMPROVE'];

/** Интенты с данными: для них имеет смысл обращаться к LLM. */
const DATA_INTENTS: readonly AssistantIntent[] = [
  'DEBTS',
  'STUDY_PLAN',
  'AVERAGE',
  'IMPROVE',
  'SCHEDULE_TODAY',
  'SCHEDULE_NEXT',
  'SICK_LEAVE',
  'REQUESTS',
  'NOTIFICATIONS',
];

/** Пометка в ответе, когда LLM не ответил (BRIEF v2 §5). */
const FALLBACK_NOTE = 'Ответ по данным кабинета: ИИ-режим недоступен.';

/** Максимум длины ответа LLM: интерфейс кабинета — про короткий текст. */
const MAX_ANSWER_LENGTH = 1000;

/** Максимум пунктов в списках ответа (минимализм текста, BRIEF v4). */
const MAX_LIST_ITEMS = 5;

/**
 * Минимальная длина свободного окна для закрытия долга, минуты.
 *
 * 10-минутная перемена между сменами бесполезна для закрытия долга: в
 * ней не успеть ни сдать работу, ни разобрать тему. Поэтому в «когда
 * закрывать» попадают только окна, в которые реально успеть.
 */
const MIN_GAP_MINUTES_FOR_DEBT = 30;

/**
 * Распознавание интента по ключевым словам.
 *
 * Порядок проверки — часть контракта:
 * - «как закрыть долги» — это STUDY_PLAN (план), а «какие у меня долги» —
 *   DEBTS (перечень), поэтому план и долги проверяются раньше общего
 *   «балла» и «расписания»;
 * - SICK_LEAVE идёт ПОСЛЕ REQUESTS/NOTIFICATIONS (чтобы «пришли справку
 *   о болезни» оставалось заявкой) и ПЕРЕД HELP (иначе «помогите
 *   оформить больничный» уходило бы в помощь);
 * - GREETING — последним перед UNKNOWN, чтобы «добрый день, какие у меня
 *   долги» уходило в DEBTS, а не в приветствие.
 *
 * Корни подобраны так, чтобы не давать ложных срабатываний: в SICK_LEAVE
 * намеренно НЕТ корня 'боле' — он матчится в «более» («более 5 баллов» —
 * это про балл, а не про больничный), поэтому проверяются только явные
 * формы «болею/заболе/болезн/больнич».
 *
 * Нормализация: нижний регистр + «ё» → «е», чтобы «незачёт» и «незачет»
 * совпадали.
 */
const INTENT_KEYWORDS: readonly { readonly intent: AssistantIntent; readonly keywords: readonly string[] }[] = [
  { intent: 'SCHEDULE_NEXT', keywords: ['следующая пара', 'следующ', 'ближайш', 'след пара', 'дальше по расписанию'] },
  { intent: 'STUDY_PLAN', keywords: ['как закрыть', 'как сдать', 'как поднять', 'как улучшить', 'план', 'подготов', 'пересдач'] },
  { intent: 'DEBTS', keywords: ['долг', 'незачет', 'хвост', 'долж'] },
  { intent: 'AVERAGE', keywords: ['средний балл', 'средняя оценка', 'успеваемость', 'gpa', 'средний бал'] },
  { intent: 'IMPROVE', keywords: ['подтянуть', 'подучить', 'слабые', 'хуже всего', 'что улучшить'] },
  // 'пара' — единственное число: «Где моя пара?» это про расписание.
  { intent: 'SCHEDULE_TODAY', keywords: ['расписание', 'пары', 'пара', 'сегодня', 'занятия'] },
  { intent: 'REQUESTS', keywords: ['заявк', 'справк', 'заявление', 'заказать'] },
  { intent: 'NOTIFICATIONS', keywords: ['уведомлен', 'новости', 'объявлен', 'напоминани', 'что нового'] },
  { intent: 'SICK_LEAVE', keywords: ['болею', 'заболе', 'болезн', 'больнич', 'не приду', 'опозда'] },
  // 'помог' намеренно рядом с 'помощ': «помоги»/«помогите» не содержат
  // корня «помощ», а без этого уходили в UNKNOWN.
  { intent: 'HELP', keywords: ['помощ', 'помог', 'что ты умеешь', 'умеешь', 'команды', 'как пользоваться'] },
  { intent: 'GREETING', keywords: ['привет', 'здравствуй', 'добрый день', 'добрый вечер', 'доброе утро', 'салют', 'хай'] },
];

/** Нормализация вопроса: регистр и «ё» не важны. */
function normalize(question: string): string {
  return question.toLowerCase().replaceAll('ё', 'е').trim();
}

/**
 * Интент вопроса (чистая функция — проверяется без БД).
 *
 * Чистота — свойство контракта: detectAssistantIntent не обращается ни к
 * БД, ни к окружению, поэтому весь разбор ключевых слов проверяется
 * юнит-тестами без фикстур.
 */
export function detectAssistantIntent(question: string): AssistantIntent {
  const text = normalize(question);
  if (text === '') {
    return 'UNKNOWN';
  }
  for (const rule of INTENT_KEYWORDS) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.intent;
    }
  }
  return 'UNKNOWN';
}

/**
 * Целевой средний балл из вопроса: число 2–5 (допустима запятая:
 * «до 4,5»), иначе 4. Числа вне диапазона и «случайные» числа внутри
 * слов (2026, группа 43) игнорируются — границы слова проверяются явно.
 */
const DEFAULT_TARGET_GPA = 4;

function targetGpaFromQuestion(question: string): number {
  const text = normalize(question);
  const matches = [...text.matchAll(/\b([2-5])(?:[.,](\d))?\b/g)];
  const last = matches.at(-1);
  if (last === undefined) {
    return DEFAULT_TARGET_GPA;
  }
  const value = Number(`${last[1]}.${last[2] ?? '0'}`);
  if (!Number.isFinite(value) || value < 2 || value > 5) {
    return DEFAULT_TARGET_GPA;
  }
  return value;
}

/** Русская форма числительного: 1 семестр, 2 семестра, 5 семестров. */
function plural(count: number, forms: readonly [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

/** Дата в виде «дд.мм.гггг» (UTC — как даты хранит сервис болезни). */
function formatDayMonthYear(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

/**
 * Нужна ли строка левериджа в ответе STUDY_PLAN.
 *
 * Леверидж — про «план роста среднего балла», поэтому он уместен только
 * когда студент спросил про балл/среднее/gpa. «Как закрыть долги» —
 * про перечень долгов и окна: строка «Все работы оценены. Цель 4 уже
 * достигнута» там была шумом.
 *
 * Граница слова — Unicode-aware: `\b` в JavaScript считается только по
 * ASCII-буквам, поэтому `\bбалл` не срабатывает перед кириллицей вовсе.
 */
const LEVERAGE_QUESTION = /(?<![\p{L}\p{N}_])(?:балл|gpa|средн)/u;

function wantsLeverage(question: string): boolean {
  return LEVERAGE_QUESTION.test(normalize(question));
}

/** Число в русской записи: 4.2 → «4,2». */
function num(value: number): string {
  return String(value).replace('.', ',');
}

/** «1 семестр» / «2 семестра» / «5 семестров». */
function semesterLabel(semester: number): string {
  return `${semester} ${plural(semester, ['семестр', 'семестра', 'семестров'])}`;
}

/** «сегодня» / «завтра» / «17.11» по дате занятия (UTC — как в расписании). */
function dayLabel(date: Date, now: Date): string {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((day - today) / 86_400_000);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'завтра';
  if (diffDays === -1) return 'вчера';
  const dayPart = String(date.getUTCDate()).padStart(2, '0');
  const monthPart = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dayPart}.${monthPart}`;
}

// ---------------------------------------------------------------------------
// Загрузка фактов: только сервисы кабинета, только данные владельца сессии
// ---------------------------------------------------------------------------

/**
 * Работы студента сессии для расчёта левериджа: зачёты (CREDIT) в средний
 * балл не входят, поэтому они отфильтровываются ещё до calculateLeverage.
 */
async function leverageWorks(session: AuthSession): Promise<readonly LeverageWork[]> {
  const grades = await getMyGrades(session);
  return grades.semesters
    .flatMap((semester) => semester.entries)
    .filter((entry) => entry.type !== 'CREDIT')
    .map((entry) => ({ value: entry.value }));
}

/**
 * Уведомление с непустым заголовком. Записи с пустым/пробельным title —
 * побитые данные (ручное вмешательство в БД): в ответе они дают пустую
 * строку вместо смысла, поэтому пропускаются.
 */
function isShowableNotification(notification: MyNotification): boolean {
  return notification.title.trim() !== '';
}

/** Факты для ответа; null — данные этому интенту не нужны. */
interface AssistantFacts {
  readonly verificationRequired: boolean;
  readonly summary: AcademicSummary | null;
  readonly leverage: LeverageResult | null;
  readonly targetGpa: number;
  readonly todayLessons: readonly ScheduleLesson[] | null;
  /** Смещение дня расписания из вопроса (0 — сегодня, 1 — завтра, 2 — послезавтра). */
  readonly dayOffset: number;
  readonly nextLesson: LessonOccurrence | null;
  readonly gapsToday: readonly FreeGap[] | null;
  readonly gapsTomorrow: readonly FreeGap[] | null;
  readonly requests: readonly MyRequest[] | null;
  readonly notifications: readonly MyNotification[] | null;
  readonly unreadCount: number | null;
  readonly sickLeaves: readonly MySickLeave[] | null;
  readonly sickNow: boolean;
}

async function loadFacts(
  session: AuthSession,
  intent: AssistantIntent,
  question: string,
  now: Date,
): Promise<AssistantFacts> {
  const empty: AssistantFacts = {
    verificationRequired: false,
    summary: null,
    leverage: null,
    targetGpa: targetGpaFromQuestion(question),
    todayLessons: null,
    dayOffset: 0,
    nextLesson: null,
    gapsToday: null,
    gapsTomorrow: null,
    requests: null,
    notifications: null,
    unreadCount: null,
    sickLeaves: null,
    sickNow: false,
  };

  if (intent === 'SCHEDULE_TODAY') {
    // «Расписание на завтра» — это расписание ЗАВТРА, а не сегодня:
    // смещение дня берём из вопроса и просим у сервиса нужный день.
    const dayOffset = dayOffsetFromQuestion(question);
    return {
      ...empty,
      dayOffset,
      todayLessons: await getMyScheduleToday(session, addUtcDays(now, dayOffset)),
    };
  }

  if (intent === 'SCHEDULE_NEXT') {
    return { ...empty, nextLesson: await getMyNextLesson(session, now) };
  }

  if (intent === 'SICK_LEAVE') {
    // Больничный не зависит от оценок, поэтому гейт верификации тут не
    // применяется: студент без сверенного билета тоже видит свой статус.
    const [sickLeaves, sickNow] = await Promise.all([
      getMySickLeaves(session),
      isSickNow(session, now),
    ]);
    return { ...empty, sickLeaves, sickNow };
  }

  if (intent === 'REQUESTS') {
    return { ...empty, requests: await getMyRequests(session) };
  }

  if (intent === 'NOTIFICATIONS') {
    const notifications = await getMyNotifications(session);
    return {
      ...empty,
      notifications,
      // Побитые записи без заголовка не считаются: иначе счётчик
      // непрочитанных расходился бы со списком в ответе.
      unreadCount: notifications.filter((item) => !item.read && isShowableNotification(item)).length,
    };
  }

  if (GRADE_INTENTS.includes(intent)) {
    let summary: AcademicSummary;
    try {
      summary = await getMyAcademicSummary(session);
    } catch (error) {
      // Гейт верификации: оценки закрыты до сверки студбилета — честная
      // заглушка вместо данных (BRIEF v2, ACCEPTANCE).
      if (error instanceof VerificationRequiredError) {
        return { ...empty, verificationRequired: true };
      }
      throw error;
    }

    // «Когда закрывать» и «сколько баллов» нужны только плану по долгам:
    // для среднего балла и «что подтянуть» лишние запросы не делаем.
    if (intent === 'AVERAGE' || intent === 'IMPROVE') {
      return { ...empty, summary };
    }

    const [gapsToday, gapsTomorrow] = await Promise.all([
      getFreeGaps(session, now),
      getFreeGaps(session, addUtcDays(now, 1)),
    ]);
    // Леверидж — строка про рост среднего балла, поэтому она нужна только
    // STUDY_PLAN и только когда студент спросил про балл/среднее/gpa.
    // Для DEBTS (перечень долгов) и запроса оценок не делаем вовсе.
    const leverage =
      intent === 'STUDY_PLAN' && wantsLeverage(question)
        ? calculateLeverage(await leverageWorks(session), empty.targetGpa)
        : null;

    return { ...empty, summary, leverage, gapsToday, gapsTomorrow };
  }

  // HELP и UNKNOWN данных не загружают: ответ не зависит от БД.
  return empty;
}

// ---------------------------------------------------------------------------
// Детерминированный ответ
// ---------------------------------------------------------------------------

/** Заглушка гейта верификации вместо оценок (интент сохраняем). */
function gateAnswer(intent: AssistantIntent): AssistantAnswer {
  return {
    intent,
    answer: 'Оценки откроются после верификации студбилета.',
    suggestions: [ASSISTANT_VERIFICATION_SUGGESTION, 'Что ты умеешь?', 'Расписание на сегодня'],
    mode: 'deterministic',
    // Заглушка не построена на данных кабинета: источников нет.
    sources: [],
  };
}

function renderGradeAnswer(intent: AssistantIntent, facts: AssistantFacts): string {
  const summary = facts.summary;
  if (summary === null) {
    return 'Не удалось загрузить оценки.';
  }

  if (intent === 'AVERAGE') {
    const lines = [
      summary.averageScore === null
        ? 'Оцененных работ пока нет.'
        : `Средний балл: ${num(summary.averageScore)} · оцененных работ: ${summary.gradedCount}`,
    ];
    const trend = trendText(summary);
    if (trend !== null) {
      lines.push(trend);
    }
    return lines.join('\n');
  }

  if (intent === 'IMPROVE') {
    if (summary.toImprove.length === 0) {
      return 'Низких оценок и долгов нет.';
    }
    const items = summary.toImprove.slice(0, MAX_LIST_ITEMS);
    const lines = [`Подтянуть: ${items.length} из ${summary.toImprove.length}`];
    for (const hint of items) {
      const reason = hint.reason === 'DEBT' ? 'долг' : `оценка ${num(hint.value ?? 0)}`;
      lines.push(`${hint.subjectName} — ${reason}, ${semesterLabel(hint.semester)}`);
    }
    if (summary.toImprove.length > items.length) {
      lines.push(`и ещё ${summary.toImprove.length - items.length}`);
    }
    return lines.join('\n');
  }

  // DEBTS / STUDY_PLAN: долги + когда закрывать (+ леверидж для STUDY_PLAN).
  //
  // Контракт (разделён намеренно): DEBTS отвечает ПЕРЕЧНЕМ долгов и
  // окнами — без строки левериджа (она про «план роста балла», а не про
  // перечень долгов). STUDY_PLAN добавляет леверидж, и только когда
  // вопрос про балл/среднее/gpa (wantsLeverage в loadFacts): «как закрыть
  // долги» — план без левериджа, «как поднять средний балл до 5» — с ним.
  const lines: string[] = [];
  if (summary.debts.length === 0) {
    lines.push('Долгов нет.');
  } else {
    lines.push(`Долгов: ${summary.debts.length}`);
    for (const debt of summary.debts.slice(0, MAX_LIST_ITEMS)) {
      lines.push(`${debt.subjectName} — ${semesterLabel(debt.semester)}`);
    }
    if (summary.debts.length > MAX_LIST_ITEMS) {
      lines.push(`и ещё ${summary.debts.length - MAX_LIST_ITEMS}`);
    }
  }

  const slots = gapSlots(facts);
  lines.push(
    slots.length === 0
      ? 'Свободных окон между парами нет.'
      : `Когда закрывать: ${slots.join(', ')}`,
  );

  const leverage = leverageText(facts.leverage);
  if (leverage !== null) {
    lines.push(leverage);
  }
  return lines.join('\n');
}

/** Тренд средней успеваемости одной строкой (null — данных мало). */
function trendText(summary: AcademicSummary): string | null {
  const { trend } = summary;
  if (trend.direction === 'UNKNOWN' || trend.lastSemester === null) {
    return null;
  }
  const delta = trend.delta === null ? '' : ` (${trend.delta > 0 ? '+' : ''}${num(trend.delta)})`;
  const direction =
    trend.direction === 'UP' ? 'растёт' : trend.direction === 'DOWN' ? 'падает' : 'стабильно';
  return `Тренд: ${direction}${delta} · последний семестр ${trend.lastSemester}`;
}

/**
 * Свободные окна на сегодня и завтра: «сегодня 11:20–13:30».
 *
 * В расписании группы окон много, но короткие (10–15 минут между
 * сменами) для закрытия долга бесполезны, поэтому за день показываем
 * два самых длинных окна — отсортированные по времени для чтения.
 * Окна короче MIN_GAP_MINUTES_FOR_DEBT отбрасываются ещё до выбора
 * «двух самых длинных»: иначе короткая перемена занимала бы место
 * реального окна, а при отсутствии длинных ответ врал бы «когда
 * закрывать» про 10-минутный промежуток.
 */
function gapSlots(facts: AssistantFacts): string[] {
  const slots: string[] = [];
  const push = (gaps: readonly FreeGap[] | null, label: string): void => {
    if (gaps === null) {
      return;
    }
    const usable = gaps.filter((gap) => gap.durationMinutes >= MIN_GAP_MINUTES_FOR_DEBT);
    const longest = [...usable]
      .sort((left, right) => right.durationMinutes - left.durationMinutes)
      .slice(0, 2)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    for (const gap of longest) {
      slots.push(`${label} ${gap.startTime}–${gap.endTime}`);
    }
  };
  push(facts.gapsToday, 'сегодня');
  push(facts.gapsTomorrow, 'завтра');
  return slots;
}

/** Леверидж до целевого среднего балла одной строкой. */
function leverageText(leverage: LeverageResult | null): string | null {
  if (leverage === null) {
    return null;
  }
  const target = num(leverage.targetGpa);
  if (leverage.currentAverage === null) {
    return `До среднего ${target}: оцененных работ пока нет.`;
  }
  const current = num(leverage.currentAverage);
  if (leverage.pendingCount === 0) {
    return leverage.alreadyAchieved
      ? `Все работы оценены. Цель ${target} уже достигнута: ${current}.`
      : `Все работы оценены. Цель ${target} текущими оценками не достигается: ${current}.`;
  }
  if (leverage.alreadyAchieved) {
    return `Цель ${target} уже достигнута: ${current}.`;
  }
  if (!leverage.achievable) {
    return `Цель ${target} недостижима: максимум ${num(leverage.maxPossibleAverage ?? 0)}.`;
  }
  // «на N предстоящих работах» — предложный падеж, число не управляет
  // существительным, поэтому форма одна на все числа.
  return `До среднего ${target}: ${num(leverage.neededSumOnPending ?? 0)} баллов на ${leverage.pendingCount} предстоящих работах — в среднем ${num(
    leverage.neededAverageOnPending ?? 0,
  )}.`;
}

function renderScheduleToday(facts: AssistantFacts): string {
  const lessons = facts.todayLessons;
  if (lessons === null || lessons.length === 0) {
    return dayEmptyLessons(facts.dayOffset);
  }
  const lines = [dayHeading(facts.dayOffset)];
  for (const lesson of lessons.slice(0, MAX_LIST_ITEMS)) {
    const status = lesson.status === 'SCHEDULED' ? '' : ` · ${lesson.statusLabel.toLowerCase()}`;
    lines.push(
      `${lesson.startTime}–${lesson.endTime} ${lesson.subjectName} · ${lesson.room}${status}`,
    );
  }
  if (lessons.length > MAX_LIST_ITEMS) {
    lines.push(`и ещё ${lessons.length - MAX_LIST_ITEMS}`);
  }
  return lines.join('\n');
}

/**
 * Статус «болею»: период активной отметки или подсказка, где отметить.
 *
 * Активность считает сервис (isSickNow): период, у которого dateTo уже
 * в прошлом, активным не считается. Даты — UTC, как их хранит сервис.
 */
function renderSickLeave(facts: AssistantFacts, now: Date): string {
  const today = startOfUtcDay(now).getTime();
  const active = (facts.sickLeaves ?? []).find(
    (leave) => leave.dateFrom.getTime() <= today && leave.dateTo.getTime() >= today,
  );
  if (facts.sickNow && active !== undefined) {
    return `Вы на больничном: ${formatDayMonthYear(active.dateFrom)} — ${formatDayMonthYear(active.dateTo)}.`;
  }
  return [
    'Активных больничных нет.',
    'Отметить болезнь — в разделе «Я заболел»: до 14 дней, деканат и преподаватели увидят.',
  ].join('\n');
}

function renderScheduleNext(facts: AssistantFacts, now: Date): string {
  const lesson = facts.nextLesson;
  if (lesson === null) {
    return 'Ближайших пар нет.';
  }
  const status = lesson.status === 'SCHEDULED' ? '' : ` · ${lesson.statusLabel.toLowerCase()}`;
  return `Следующая пара: ${dayLabel(lesson.effectiveDate, now)}, ${lesson.startTime}–${
    lesson.endTime
  } ${lesson.subjectName} · ${lesson.effectiveRoom}${status}`;
}

function renderRequests(facts: AssistantFacts): string {
  const requests = facts.requests;
  if (requests === null || requests.length === 0) {
    return 'Заявок нет.';
  }
  const lines = [`Заявок: ${requests.length}`];
  for (const request of requests.slice(0, MAX_LIST_ITEMS)) {
    lines.push(`${request.typeLabel} — ${request.statusLabel.toLowerCase()}`);
  }
  if (requests.length > MAX_LIST_ITEMS) {
    lines.push(`и ещё ${requests.length - MAX_LIST_ITEMS}`);
  }
  return lines.join('\n');
}

function renderNotifications(facts: AssistantFacts): string {
  const notifications = facts.notifications;
  if (notifications === null || notifications.length === 0) {
    return 'Уведомлений нет.';
  }
  // Побитые записи без заголовка пропускаем: иначе вместо строки
  // уведомления в ответе появляется пустая строка.
  const unread = notifications.filter((item) => !item.read && isShowableNotification(item));
  if (unread.length === 0) {
    return 'Непрочитанных нет.';
  }
  const lines = [`Непрочитанных: ${unread.length}`];
  for (const notification of unread.slice(0, MAX_LIST_ITEMS)) {
    lines.push(notification.title);
  }
  if (unread.length > MAX_LIST_ITEMS) {
    lines.push(`и ещё ${unread.length - MAX_LIST_ITEMS}`);
  }
  return lines.join('\n');
}

const HELP_TEXT =
  'Отвечаю по вашим данным: долги, план закрытия, средний балл, что подтянуть, расписание, заявки, уведомления.';

/** Приветствие: не «не понял вопрос», а понятный вход в диалог. */
const GREETING_TEXT =
  'Здравствуйте! Спросите про долги, средний балл, расписание, заявки или уведомления.';

function renderUnknown(): string {
  return 'Не понял вопрос.\nСпросите про долги, средний балл, расписание, заявки или уведомления.';
}

/** Подсказки-follow-up (2–4 коротких вопроса-чипа). */
function suggestionsFor(intent: AssistantIntent, verificationRequired: boolean): readonly string[] {
  if (verificationRequired) {
    return [ASSISTANT_VERIFICATION_SUGGESTION, 'Что ты умеешь?', 'Расписание на сегодня'];
  }
  switch (intent) {
    case 'DEBTS':
      return ['Как закрыть долги?', 'Что подтянуть?', 'Какой средний балл?'];
    case 'STUDY_PLAN':
      return ['Какие у меня долги?', 'Что подтянуть?', 'Расписание на сегодня'];
    case 'AVERAGE':
      return ['Что подтянуть?', 'Как закрыть долги?', 'Как поднять средний балл до 5?'];
    case 'IMPROVE':
      return ['Как закрыть долги?', 'Какой средний балл?', 'Расписание на сегодня'];
    case 'SCHEDULE_TODAY':
      return ['Какая следующая пара?', 'Какие у меня заявки?', 'Есть новые уведомления?'];
    case 'SCHEDULE_NEXT':
      return ['Расписание на сегодня', 'Какие у меня долги?', 'Что подтянуть?'];
    case 'SICK_LEAVE':
      return ['Что ты умеешь?', 'Расписание на сегодня', 'Какие у меня долги?'];
    case 'REQUESTS':
      return ['Есть новые уведомления?', 'Расписание на сегодня', 'Какой средний балл?'];
    case 'NOTIFICATIONS':
      return ['Какие у меня заявки?', 'Расписание на сегодня', 'Какой средний балл?'];
    case 'HELP':
    case 'GREETING':
      return ['Какие у меня долги?', 'Расписание на сегодня', 'Какой средний балл?'];
    case 'UNKNOWN':
      return ['Что ты умеешь?', 'Расписание на сегодня', 'Какой средний балл?'];
  }
}

/** Полный детерминированный ответ (тот же результат, что и без LLM). */
function renderAnswer(intent: AssistantIntent, facts: AssistantFacts, now: Date): AssistantAnswer {
  if (facts.verificationRequired) {
    return gateAnswer(intent);
  }

  let answer: string;
  switch (intent) {
    case 'DEBTS':
    case 'STUDY_PLAN':
    case 'AVERAGE':
    case 'IMPROVE':
      answer = renderGradeAnswer(intent, facts);
      break;
    case 'SCHEDULE_TODAY':
      answer = renderScheduleToday(facts);
      break;
    case 'SCHEDULE_NEXT':
      answer = renderScheduleNext(facts, now);
      break;
    case 'SICK_LEAVE':
      answer = renderSickLeave(facts, now);
      break;
    case 'REQUESTS':
      answer = renderRequests(facts);
      break;
    case 'NOTIFICATIONS':
      answer = renderNotifications(facts);
      break;
    case 'HELP':
      answer = HELP_TEXT;
      break;
    case 'GREETING':
      answer = GREETING_TEXT;
      break;
    case 'UNKNOWN':
      answer = renderUnknown();
      break;
  }

  return {
    intent,
    answer,
    suggestions: suggestionsFor(intent, false),
    mode: 'deterministic',
    sources: assistantSourcesFor(intent),
  };
}

// ---------------------------------------------------------------------------
// Контекст для LLM: только вычисленная сводка владельца сессии
// ---------------------------------------------------------------------------

/**
 * Сводка для LLM — те же факты, что и в детерминированном ответе, но
 * списком «поле: значение». Никаких сырых таблиц БД и никаких чужих
 * данных: всё посчитано сервисами кабинета по сессии.
 */
function buildLlmContext(intent: AssistantIntent, facts: AssistantFacts, now: Date): string {
  const lines: string[] = [];

  if (facts.summary !== null) {
    lines.push(
      `Средний балл: ${
        facts.summary.averageScore === null ? 'нет оценок' : num(facts.summary.averageScore)
      }`,
      `Оцененных работ: ${facts.summary.gradedCount}`,
    );
    if (facts.summary.debts.length === 0) {
      lines.push('Долги: нет');
    } else {
      lines.push(`Долгов: ${facts.summary.debts.length}`);
      for (const debt of facts.summary.debts) {
        lines.push(`- ${debt.subjectName} (${semesterLabel(debt.semester)})`);
      }
    }
    if (facts.summary.toImprove.length === 0) {
      lines.push('Что подтянуть: нет');
    } else {
      lines.push(
        ...facts.summary.toImprove.map(
          (hint) =>
            `- ${hint.subjectName} (${hint.reason === 'DEBT' ? 'долг' : `оценка ${num(hint.value ?? 0)}`}, ${semesterLabel(hint.semester)})`,
        ),
      );
    }
    const trend = trendText(facts.summary);
    if (trend !== null) {
      lines.push(trend);
    }
  }

  const leverage = leverageText(facts.leverage);
  if (leverage !== null) {
    lines.push(leverage);
  }

  const slots = gapSlots(facts);
  if (slots.length > 0) {
    lines.push(`Свободные окна: ${slots.join(', ')}`);
  }

  if (facts.todayLessons !== null) {
    const day = dayWord(facts.dayOffset);
    lines.push(
      facts.todayLessons.length === 0
        ? `Пары ${day}: нет`
        : `Пары ${day}: ${facts.todayLessons
            .map((lesson) => `${lesson.startTime}–${lesson.endTime} ${lesson.subjectName} (${lesson.room})`)
            .join('; ')}`,
    );
  }

  if (facts.sickLeaves !== null) {
    lines.push(
      facts.sickLeaves.length === 0
        ? 'Больничные: нет'
        : `Больничные: ${facts.sickLeaves
            .map(
              (leave) =>
                `${formatDayMonthYear(leave.dateFrom)}—${formatDayMonthYear(leave.dateTo)}`,
            )
            .join('; ')}`,
      `Болеет сейчас: ${facts.sickNow ? 'да' : 'нет'}`,
    );
  }

  if (facts.nextLesson !== null) {
    lines.push(
      `Следующая пара: ${dayLabel(facts.nextLesson.effectiveDate, now)}, ${
        facts.nextLesson.startTime
      }–${facts.nextLesson.endTime} ${facts.nextLesson.subjectName} (${facts.nextLesson.effectiveRoom})`,
    );
  }

  if (facts.requests !== null) {
    lines.push(
      facts.requests.length === 0
        ? 'Заявки: нет'
        : `Заявки: ${facts.requests
            .map((request) => `${request.typeLabel} — ${request.statusLabel.toLowerCase()}`)
            .join('; ')}`,
    );
  }

  if (facts.notifications !== null) {
    lines.push(
      facts.notifications.length === 0
        ? 'Уведомления: нет'
        : `Уведомления: непрочитанных ${facts.unreadCount ?? 0}; ${facts.notifications
            .slice(0, MAX_LIST_ITEMS)
            .map((notification) => notification.title)
            .join('; ')}`,
    );
  }

  return lines.length === 0 ? 'Данных по вопросу нет.' : lines.join('\n');
}

// ---------------------------------------------------------------------------
// Публичная точка входа
// ---------------------------------------------------------------------------

/**
 * Ответ ассистента на вопрос студента.
 *
 * Данные — только владельца сессии: все сервисы резолвят studentId сами
 * (studentId извне не принимается, ownership.ts). Интенты с оценками у
 * неверифицированного студента получают заглушку гейта. LLM, если клиент
 * передан, только переформулирует ответ по переданной сводке; при ошибке
 * или таймауте возвращается детерминированный ответ с пометкой.
 */
export async function askAssistant(
  session: AuthSession,
  question: string,
  options: AskAssistantOptions = {},
): Promise<AssistantAnswer> {
  const now = options.now ?? new Date();
  const intent = detectAssistantIntent(question);
  const facts = await loadFacts(session, intent, question, now);
  const deterministic = renderAnswer(intent, facts, now);

  const llm = options.llm ?? null;
  // UNKNOWN/HELP и заглушка гейта не отдаются LLM: врать не на чем, а
  // данные закрытого раздела модели не передаются вовсе.
  if (llm === null || !DATA_INTENTS.includes(intent) || facts.verificationRequired) {
    return deterministic;
  }

  try {
    const text = await llm.complete({
      system: ASSISTANT_SYSTEM_PROMPT,
      user: [
        `Вопрос студента: «${question.trim().slice(0, 500)}»`,
        `Интент: ${intent}`,
        'Данные студента:',
        buildLlmContext(intent, facts, now),
      ].join('\n'),
    });
    const answer = text.trim().slice(0, MAX_ANSWER_LENGTH);
    if (answer === '') {
      return deterministic;
    }
    // LLM переформулирует те же факты кабинета — источники те же.
    return {
      intent,
      answer,
      suggestions: deterministic.suggestions,
      mode: 'llm',
      sources: deterministic.sources,
    };
  } catch (error) {
    // Ошибка/таймаут LLM → детерминированный ответ с пометкой.
    // В лог уходит только текст ошибки: заголовки (и ключ) в него не входят.
    console.warn('[assistant] LLM недоступен:', error instanceof Error ? error.message : error);
    return {
      ...deterministic,
      answer: `${deterministic.answer}\n${FALLBACK_NOTE}`,
    };
  }
}

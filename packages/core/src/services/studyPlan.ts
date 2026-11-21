/**
 * AI-ассистент ПРЕПОДАВАТЕЛЯ: RAG по загруженному учебному плану
 * (BRIEF v2 §5, P2b).
 *
 * Поток: преподаватель загружает учебный план (.md/.txt, ≤1 МБ) → файл
 * уходит в ПРИВАТНОЕ хранилище (storage.ts, study-plans/<teacherId>/,
 * вне webroot, без публичных ссылок) → текст плана индексируется
 * детерминированным TF-IDF по чанкам → askStudyPlanAssistant находит
 * релевантные разделы и отвечает цитатами из плана владельца сессии,
 * сопоставляя их с долгами студентов его групп.
 *
 * Архитектура (решение Hermes, как у ассистента студента):
 * - детерминированный движок — основа: свой парсинг, свой индекс, свой
 *   поиск. Никаких внешних зависимостей (никаких векторов из облака):
 *   индекс считается за миллисекунды и одинаково на каждой машине;
 * - LLM опционален (llm.ts, инъекция клиента + env ASSISTANT_LLM_*):
 *   модель только переформулирует ответ по переданным чанкам плана
 *   владельца сессии. Нет ключа → deterministic; ошибка/таймаут →
 *   детерминированный ответ с пометкой;
 * - владение: teacherId берётся ТОЛЬКО из сессии (requireTeacher),
 *   чужой planId → NOT_OWNER (→ 404, ответ не отличается от «не существует»),
 *   чужих планов в ответе и в контексте LLM нет по построению.
 *
 * Минимализм текста (BRIEF v4): одна мысль на строку, цитаты — построчно.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireTeacher } from '../ownership';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import type { AuthSession } from '../session';
import {
  MAX_STUDY_PLAN_SIZE_BYTES,
  STUDY_PLAN_ALLOWED_MIME,
  IdCardStorageError,
  deleteStudyPlan as deleteStudyPlanFile,
  readStudyPlan,
  saveStudyPlan,
} from '../storage';
import { TEACHER_ASSISTANT_SYSTEM_PROMPT, type LlmClient } from '../llm';

// ---------------------------------------------------------------------------
// Схемы входа (единый контракт сервиса и маршрута)
// ---------------------------------------------------------------------------

/** UUID: идентификаторы планов в базе — стандартные uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Загрузка плана: название + исходные данные файла. */
export const studyPlanUploadSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Укажите название плана.')
    .max(120, 'Название плана слишком длинное (максимум 120 символов).'),
  /** Оригинальное имя файла — только для показа в списке. */
  fileName: z.string().trim().min(1, 'Имя файла не указано.').max(255, 'Имя файла слишком длинное.'),
  mime: z.enum(Object.keys(STUDY_PLAN_ALLOWED_MIME) as [string, ...string[]], {
    message: `Допустимые форматы плана: ${Object.keys(STUDY_PLAN_ALLOWED_MIME).join(', ')}.`,
  }),
  buffer: z.instanceof(Buffer),
});

export type UploadStudyPlanInput = z.infer<typeof studyPlanUploadSchema>;

/** Вопрос ассистенту: план необязателен (нет → самый свежий план). */
export const studyPlanQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Напишите вопрос.')
    .max(500, 'Вопрос слишком длинный: максимум 500 символов.'),
  planId: z
    .string()
    .trim()
    .regex(UUID, 'Некорректный идентификатор плана.')
    .optional(),
});

export type AskStudyPlanAssistantInput = z.infer<typeof studyPlanQuestionSchema>;

// ---------------------------------------------------------------------------
// Публичные типы
// ---------------------------------------------------------------------------

/** План в списке преподавателя. storagePath наружу НЕ отдаётся. */
export interface StudyPlanListItem {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

/** Цитата-подсказка: раздел плана и оценка релевантности (0..1). */
export interface StudyPlanCitation {
  readonly section: string;
  readonly score: number;
}

export type AssistantMode = 'deterministic' | 'llm';

/** Ответ ассистента преподавателя. */
export interface StudyPlanAssistantAnswer {
  readonly answer: string;
  readonly mode: AssistantMode;
  readonly citations: readonly StudyPlanCitation[];
  readonly suggestions: readonly string[];
  /** План, по которому данбран ответ (null — планов нет вовсе). */
  readonly plan: { readonly id: string; readonly title: string } | null;
}

export interface AskStudyPlanAssistantOptions {
  /** Клиент LLM; null/undefined — детерминированный режим. */
  readonly llm?: LlmClient | null;
}

/** Стартовые вопросы на экране ассистента преподавателя (пустое состояние и чипы). */
export const TEACHER_ASSISTANT_STARTER_QUESTIONS: readonly string[] = [
  'Какие темы проходят в 3 модуле?',
  'Что по лабораторным?',
  'Где контрольные точки?',
];

/** Сколько чанков плана уходит в ответ. */
const TOP_CHUNKS = 3;

/** Максимум длины ответа LLM (интерфейс кабинета — про короткий текст). */
const MAX_ANSWER_LENGTH = 1000;

/** Максимум долгов в сопоставлении (минимализм текста, BRIEF v4). */
const MAX_DEBT_LINES = 3;

/** Пометка в ответе, когда LLM не ответил (BRIEF v2 §5). */
const FALLBACK_NOTE = 'Ответ по плану: ИИ-режим недоступен.';

/** Ответ, когда у преподавателя нет ни одного плана. */
const NO_PLAN_ANSWER = 'Загрузите учебный план — ассистент ответит по нему.';

/** Ответ, когда запись плана есть, а файл в хранилище пропал. */
const PLAN_UNAVAILABLE_ANSWER =
  'Учебный план недоступен: файл не найден в хранилище. Загрузите план заново — ассистент ответит по нему.';

/** Подпись раздела для текста до первого заголовка. */
const PREAMBLE_SECTION = 'Начало плана';

// ---------------------------------------------------------------------------
// Токенизация: русский текст, ё→е, стоп-слова
// ---------------------------------------------------------------------------

/**
 * Стоп-слова русского языка (список зафиксирован требованиями задачи):
 * сами по себе они не несут темы, поэтому в индекс не попадают.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'и', 'в', 'на', 'к', 'с', 'по', 'а', 'но', 'что', 'это', 'для', 'из', 'от',
  'до', 'за', 'при', 'не', 'ни', 'же', 'ли', 'бы', 'как', 'так', 'его', 'ее',
  'их', 'все', 'был', 'была', 'было', 'быть', 'мы', 'вы', 'они', 'я', 'он',
  'она', 'у', 'о', 'об',
]);

/**
 * Токены текста: нижний регистр, «ё» → «е», разделители — всё, что не
 * буква и не цифра (пунктуация и markdown-разметка исчезают сами).
 * Односимвольные токены отбрасываются: «3 модуля» несёт смысл в слове
 * «модуля», а не в цифре.
 */
export function tokenizePlanText(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * Мягкий/твёрдый знак на конце токена не должен мешать сравнению форм:
 * «модуль» ↔ «модуля» ↔ «модуле» — один корень «модул».
 */
function stripTrailingSign(token: string): string {
  return token.replace(/[ьъ]+$/, '');
}

/** Длина общего начала двух строк. */
function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

/**
 * Минимальная длина общего корня для распознавания словоформы.
 * Пять символов русского слова — это почти всегда один корень
 * («модул», «лабораторн», «зачет»), а случайные совпадения таких
 * длины в осмысленном вопросе не встречаются.
 */
const MIN_STEM_LENGTH = 5;

/**
 * Совпадение токена вопроса с токеном плана — три правила, все про
 * словоформы, без лемматизации:
 * 1. точное равенство;
 * 2. префиксный поиск: токен вопроса — начало токена плана
 *    («модул» находит «модульный»), мягкий знак на конце игнорируется;
 * 3. общий корень ≥5 символов: русское окончание меняется ВНУТРИ слова
 *    («лабораторным» ↔ «лабораторные»), и одного префикса тут мало.
 */
export function tokensMatch(queryToken: string, planToken: string): boolean {
  if (queryToken === planToken) {
    return true;
  }
  const query = stripTrailingSign(queryToken);
  const plan = stripTrailingSign(planToken);
  if (query === plan) {
    return true;
  }
  if (query.length >= 3 && plan.length >= 5 && plan.startsWith(query)) {
    return true;
  }
  return commonPrefixLength(query, plan) >= MIN_STEM_LENGTH;
}

/** Совпадение в любую сторону (вопрос ↔ тема долга). */
function tokensOverlap(left: string, right: string): boolean {
  return tokensMatch(left, right) || tokensMatch(right, left);
}

// ---------------------------------------------------------------------------
// Парсинг плана: заголовки и абзацы
// ---------------------------------------------------------------------------

/** Заголовок markdown: от # до ###### в начале строки. */
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

/** Раздел плана: заголовок (уровень 0 — текст до первого заголовка). */
export interface PlanSection {
  readonly title: string;
  readonly level: number;
}

/** Раздел с исходными строками — то, из чего строятся чанки. */
export interface PlanSectionLines {
  readonly title: string;
  readonly level: number;
  readonly lines: readonly string[];
}

/** Разобранный план: разделы по порядку + заголовок плана. */
export interface ParsedPlan {
  readonly sections: readonly PlanSection[];
  /** Первый заголовок плана (null — план без заголовков). */
  readonly title: string | null;
}

/** Заголовок без markdown-разметки: `**Модуль 3**` → «Модуль 3». */
function cleanHeading(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

/**
 * Разбивает текст плана на разделы: строка `#`/`##`/`###` (до шести)
 * открывает новый раздел, всё до первого заголовка — раздел уровня 0.
 * Разделы без текста (заголовок без абзацев) отбрасываются: чанков из
 * них не вышло бы.
 */
export function parseStudyPlanSections(text: string): readonly PlanSectionLines[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sections: { title: string; level: number; lines: string[] }[] = [
    { title: '', level: 0, lines: [] },
  ];

  for (const line of lines) {
    const heading = HEADING_PATTERN.exec(line.trim());
    if (heading !== null) {
      sections.push({
        title: cleanHeading(heading[2] ?? ''),
        level: heading[1]?.length ?? 1,
        lines: [],
      });
      continue;
    }
    sections[sections.length - 1]?.lines.push(line);
  }

  return sections
    .filter((section) => section.lines.join('').trim() !== '')
    .map((section) => ({ title: section.title, level: section.level, lines: section.lines }));
}

/**
 * Разобранный план как структура: разделы (заголовки и абзацы) и
 * заголовок плана — первый заголовок любого уровня. Функция чистая:
 * парсинг не зависит ни от БД, ни от хранилища и проверяется тестом.
 */
export function parseStudyPlanText(text: string): ParsedPlan {
  const sections = parseStudyPlanSections(text);
  const firstHeading = sections.find((section) => section.level >= 1 && section.title !== '');
  return {
    sections: sections.map((section) => ({ title: section.title, level: section.level })),
    title: firstHeading?.title ?? null,
  };
}

// ---------------------------------------------------------------------------
// Чанки: заголовок + его абзацы, ~500 символов с перекрытием по абзацам
// ---------------------------------------------------------------------------

/** Целевой размер чанка, символов. */
const CHUNK_TARGET_CHARS = 500;

/** Один чанк плана: раздел и его текст. */
export interface PlanChunk {
  readonly id: string;
  /** Заголовок раздела ('' — текст до первого заголовка). */
  readonly section: string;
  readonly text: string;
}

/**
 * Абзацы раздела: непустые строки, идущие подряд, — один абзац; пустая
 * строка разделяет абзацы (списки остаются одним абзацем до пустой строки).
 */
function paragraphsOf(lines: readonly string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line.trimEnd());
  }
  if (current.length > 0) {
    paragraphs.push(current.join('\n'));
  }
  return paragraphs;
}

/** Длинный абзац режется по предложениям, затем по словам (без потери текста). */
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_TARGET_CHARS) {
    return [paragraph];
  }
  const pieces: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') {
      pieces.push(current);
      current = '';
    }
  };
  for (const sentence of paragraph.split(/(?<=[.!?;])\s+/)) {
    if (sentence.length > CHUNK_TARGET_CHARS) {
      flush();
      for (const word of sentence.split(/\s+/)) {
        if (current !== '' && current.length + 1 + word.length > CHUNK_TARGET_CHARS) {
          flush();
        }
        current = current === '' ? word : `${current} ${word}`;
      }
      flush();
      continue;
    }
    if (current !== '' && current.length + 1 + sentence.length > CHUNK_TARGET_CHARS) {
      flush();
    }
    current = current === '' ? sentence : `${current} ${sentence}`;
  }
  flush();
  return pieces;
}

/**
 * Чанки одного раздела: абзацы набираются до ~500 символов, новый чанк
 * начинается с ПОСЛЕДНЕГО абзаца предыдущего (перекрытие по абзацам) —
 * так граница не теряет контекст, а повтор не размножается.
 */
function chunkParagraphs(paragraphs: readonly string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current.join('\n\n'));
    }
  };

  for (const paragraph of paragraphs) {
    const wouldExceed =
      current.length > 0 && length + 2 + paragraph.length > CHUNK_TARGET_CHARS;
    if (wouldExceed) {
      flush();
      // Перекрытие: последний абзац предыдущего чанка идёт в новый.
      const previous = current;
      current = previous.length > 1 ? [previous[previous.length - 1] as string, paragraph] : [paragraph];
      length = current.join('\n\n').length;
      continue;
    }
    current.push(paragraph);
    length += (current.length > 1 ? 2 : 0) + paragraph.length;
  }
  flush();
  return chunks;
}

/**
 * Чанки всего плана: каждая секция (заголовок + его абзацы) режется
 * независимо, идентификатор чанка — «s<индекс секции>-c<индекс чанка>»
 * (детерминирован: используется как стабильный ключ сортировки).
 */
export function buildPlanChunks(sections: readonly PlanSectionLines[]): PlanChunk[] {
  const chunks: PlanChunk[] = [];
  sections.forEach((section, sectionIndex) => {
    const paragraphs = paragraphsOf(section.lines).flatMap(splitLongParagraph);
    chunkParagraphs(paragraphs).forEach((text, chunkIndex) => {
      chunks.push({ id: `s${sectionIndex}-c${chunkIndex}`, section: section.title, text });
    });
  });
  return chunks;
}

// ---------------------------------------------------------------------------
// Индекс: TF-IDF по чанкам (детерминированный, без внешних зависимостей)
// ---------------------------------------------------------------------------

/** Индекс плана: термы, веса и нормы векторов чанков. */
export interface StudyPlanIndex {
  readonly chunks: readonly PlanChunk[];
  /** Частоты термов каждого чанка (терм → количество). */
  readonly terms: readonly Map<string, number>[];
  /** Нормы векторов чанков (√Σ(tf·idf)²). */
  readonly norms: readonly number[];
  /** idf терма по корпусу чанков. */
  readonly idf: ReadonlyMap<string, number>;
  /** Словарь термов корпуса — для префиксного расширения вопроса. */
  readonly vocabulary: readonly string[];
}

/**
 * Строит индекс плана. Термы чанка — токены «заголовок + текст»: тема
 * раздела участвует в поиске на равных со своим содержимым.
 */
export function buildStudyPlanIndex(chunks: readonly PlanChunk[]): StudyPlanIndex {
  const terms = chunks.map((chunk) => {
    const counts = new Map<string, number>();
    for (const token of tokenizePlanText(`${chunk.section} ${chunk.text}`)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
  });

  const documentFrequency = new Map<string, number>();
  for (const chunkTerms of terms) {
    for (const term of chunkTerms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = chunks.length;
  const idf = new Map<string, number>();
  for (const [term, frequency] of documentFrequency) {
    // Сглаженный idf (как в BM25): всегда положителен, редкий терм весит больше.
    idf.set(term, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
  }

  const norms = terms.map((chunkTerms) => {
    let sum = 0;
    for (const [term, tf] of chunkTerms) {
      const weight = tf * (idf.get(term) ?? 0);
      sum += weight * weight;
    }
    return Math.sqrt(sum);
  });

  return {
    chunks,
    terms,
    norms,
    idf,
    vocabulary: [...documentFrequency.keys()],
  };
}

/** Найденный чанк с оценкой релевантности (косинус TF-IDF). */
export interface RetrievedChunk {
  readonly chunk: PlanChunk;
  readonly score: number;
}

/**
 * Ищет topN релевантных чанков плана для вопроса.
 *
 * Токены вопроса расширяются префиксным совпадением по словарю плана
 * (tokensMatch), поэтому «модуле» находит «модуля» и «модульный».
 * Оценка — косинус между TF-IDF вектором вопроса и вектором чанка;
 * чанки без пересечения термов не возвращаются (score 0 отфильтрован),
 * поэтому «вопрос вне плана» честно даёт пустой результат.
 * Порядок детерминирован: score по убыванию, при равенстве — по id чанка.
 */
export function retrieveChunks(
  index: StudyPlanIndex,
  question: string,
  topN = TOP_CHUNKS,
): RetrievedChunk[] {
  const queryTokens = tokenizePlanText(question);
  if (queryTokens.length === 0 || index.chunks.length === 0) {
    return [];
  }

  // Вектор вопроса: терм плана → сколько токенов вопроса его нашли (× idf).
  const queryWeights = new Map<string, number>();
  for (const term of index.vocabulary) {
    let matches = 0;
    for (const token of queryTokens) {
      if (tokensMatch(token, term)) {
        matches += 1;
      }
    }
    if (matches > 0) {
      queryWeights.set(term, matches * (index.idf.get(term) ?? 0));
    }
  }
  if (queryWeights.size === 0) {
    return [];
  }

  let queryNormSquared = 0;
  for (const weight of queryWeights.values()) {
    queryNormSquared += weight * weight;
  }
  const queryNorm = Math.sqrt(queryNormSquared);

  const scored: RetrievedChunk[] = index.chunks.map((chunk, chunkIndex) => {
    const chunkTerms = index.terms[chunkIndex] ?? new Map<string, number>();
    let dot = 0;
    for (const [term, queryWeight] of queryWeights) {
      const tf = chunkTerms.get(term);
      if (tf === undefined) {
        continue;
      }
      dot += queryWeight * tf * (index.idf.get(term) ?? 0);
    }
    const chunkNorm = index.norms[chunkIndex] ?? 0;
    const score = chunkNorm === 0 || queryNorm === 0 ? 0 : dot / (chunkNorm * queryNorm);
    return { chunk, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
    .slice(0, Math.max(0, topN));
}

// ---------------------------------------------------------------------------
// Долги студентов преподавателя (сопоставление с темами плана)
// ---------------------------------------------------------------------------

/** Долги студентов по одной дисциплине (у групп преподавателя). */
interface TeacherDebtSubject {
  readonly subjectName: string;
  readonly studentsCount: number;
  readonly groupNames: readonly string[];
}

/**
 * Долги студентов групп преподавателя: незачёты (CREDIT с passed=false)
 * у студентов, у которых преподаватель ведёт пары (ScheduleEntry → Group
 * → Student → Grade). Данные только для ассистента этого преподавателя.
 */
async function loadTeacherDebts(teacherId: string): Promise<readonly TeacherDebtSubject[]> {
  const entries = await prisma().scheduleEntry.findMany({
    where: { teacherId },
    select: { groupId: true },
    distinct: ['groupId'],
  });
  const groupIds = entries.map((entry) => entry.groupId);
  if (groupIds.length === 0) {
    return [];
  }

  const students = await prisma().student.findMany({
    where: { groupId: { in: groupIds } },
    select: { id: true, group: { select: { name: true } } },
  });
  if (students.length === 0) {
    return [];
  }

  const debts = await prisma().grade.findMany({
    where: { studentId: { in: students.map((student) => student.id) }, type: 'CREDIT', passed: false },
    select: { subject: { select: { name: true } }, studentId: true },
  });

  const groupNameById = new Map(students.map((student) => [student.id, student.group.name]));
  const bySubject = new Map<string, { students: Set<string>; groups: Set<string> }>();
  for (const debt of debts) {
    const subjectName = debt.subject.name;
    const entry = bySubject.get(subjectName) ?? { students: new Set<string>(), groups: new Set<string>() };
    entry.students.add(debt.studentId);
    const groupName = groupNameById.get(debt.studentId);
    if (groupName !== undefined) {
      entry.groups.add(groupName);
    }
    bySubject.set(subjectName, entry);
  }

  return [...bySubject.entries()]
    .map(([subjectName, entry]) => ({
      subjectName,
      studentsCount: entry.students.size,
      groupNames: [...entry.groups].sort((left, right) => left.localeCompare(right, 'ru')),
    }))
    .sort(
      (left, right) =>
        right.studentsCount - left.studentsCount ||
        left.subjectName.localeCompare(right.subjectName, 'ru'),
    );
}

/** Долги, тема которых упомянута в вопросе (совпадение токенов дисциплины). */
function debtsMatchingQuestion(
  debts: readonly TeacherDebtSubject[],
  questionTokens: readonly string[],
): readonly TeacherDebtSubject[] {
  return debts.filter((debt) => {
    const subjectTokens = tokenizePlanText(debt.subjectName);
    return subjectTokens.some((subjectToken) =>
      questionTokens.some((questionToken) => tokensOverlap(questionToken, subjectToken)),
    );
  });
}

/**
 * Долги, тема которых совпала с НАЙДЕННЫМИ разделами плана: сопоставление
 * «тема плана ↔ долги студентов» (BRIEF v2 §5). Преподаватель спрашивает
 * про лабораторные — и видит, у кого из его студентов долг по дисциплине,
 * которую эти разделы плана описывают.
 */
function debtsMatchingSections(
  debts: readonly TeacherDebtSubject[],
  retrieved: readonly RetrievedChunk[],
): readonly TeacherDebtSubject[] {
  const sectionTokens = retrieved.flatMap((item) =>
    item.chunk.section === '' ? [] : tokenizePlanText(item.chunk.section),
  );
  if (sectionTokens.length === 0) {
    return [];
  }
  return debts.filter((debt) => {
    const subjectTokens = tokenizePlanText(debt.subjectName);
    return subjectTokens.some((subjectToken) =>
      sectionTokens.some((sectionToken) => tokensOverlap(subjectToken, sectionToken)),
    );
  });
}

/** Долги для ответа: по вопросу и по найденным разделам, без повторов. */
function debtsForAnswer(
  debts: readonly TeacherDebtSubject[],
  questionTokens: readonly string[],
  retrieved: readonly RetrievedChunk[],
): readonly TeacherDebtSubject[] {
  if (retrieved.length === 0) {
    return [];
  }
  const byName = new Map<string, TeacherDebtSubject>();
  for (const debt of [...debtsMatchingQuestion(debts, questionTokens), ...debtsMatchingSections(debts, retrieved)]) {
    byName.set(debt.subjectName, debt);
  }
  return [...byName.values()].slice(0, MAX_DEBT_LINES);
}

/** Раздел плана, лучше всего соответствующий теме дисциплины (null — нет). */
function sectionForSubject(index: StudyPlanIndex, subjectName: string): string | null {
  const subjectTokens = tokenizePlanText(subjectName);
  if (subjectTokens.length === 0) {
    return null;
  }
  let best: { section: string; score: number } | null = null;
  for (const chunk of index.chunks) {
    if (chunk.section === '') {
      continue;
    }
    const sectionTokens = tokenizePlanText(chunk.section);
    const score = sectionTokens.filter((sectionToken) =>
      subjectTokens.some((subjectToken) => tokensOverlap(subjectToken, sectionToken)),
    ).length;
    if (score === 0) {
      continue;
    }
    if (best === null || score > best.score) {
      best = { section: chunk.section, score };
    }
  }
  return best?.section ?? null;
}

// ---------------------------------------------------------------------------
// Детерминированный ответ
// ---------------------------------------------------------------------------

/** Русская форма числительного: 1 студент, 2 студента, 5 студентов. */
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

/** Короткая цитата из чанка: одна строка, обрезка по границе слова. */
function snippet(text: string, limit = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) {
    return flat;
  }
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/** Оценка релевантности с двумя знаками (детерминированно). */
function score2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Детерминированный ответ: цитаты-подсказки из разделов плана и, если
 * тема вопроса совпала с долгами студентов, сопоставление «долги →
 * раздел плана». Всё — одной мыслью на строку (BRIEF v4).
 */
function renderAnswer(
  planTitle: string,
  retrieved: readonly RetrievedChunk[],
  debts: readonly TeacherDebtSubject[],
  index: StudyPlanIndex,
): string {
  if (retrieved.length === 0) {
    return `В плане «${planTitle}» не найдено ответа на этот вопрос.`;
  }

  const lines = [`По плану «${planTitle}»:`];
  for (const item of retrieved) {
    const section = item.chunk.section === '' ? PREAMBLE_SECTION : item.chunk.section;
    lines.push(`— «${section}»: ${snippet(item.chunk.text)}`);
  }

  // Сопоставление тем плана с долгами студентов: показываем только когда
  // тема вопроса или найденного раздела совпала с дисциплиной долга.
  for (const debt of debts) {
    const section = sectionForSubject(index, debt.subjectName);
    const groups = debt.groupNames.slice(0, 3).join(', ');
    const tail = section === null ? '' : ` → раздел «${section}»`;
    lines.push(
      `Долги по «${debt.subjectName}»: ${debt.studentsCount} ${plural(debt.studentsCount, [
        'студент',
        'студента',
        'студентов',
      ])} (${groups})${tail}`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Контекст для LLM: только чанки плана владельца сессии
// ---------------------------------------------------------------------------

/** Сводка для LLM: вопрос + разделы плана (никаких сырых таблиц БД). */
function buildLlmContext(planTitle: string, question: string, retrieved: readonly RetrievedChunk[]): string {
  return [
    `Вопрос преподавателя: «${question.trim().slice(0, 500)}»`,
    `Учебный план: «${planTitle}»`,
    'Разделы плана:',
    ...retrieved.map(
      (item) => `— «${item.chunk.section === '' ? PREAMBLE_SECTION : item.chunk.section}»: ${snippet(item.chunk.text, 400)}`,
    ),
    'Отвечай только по разделам плана выше.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Загрузка, список, удаление планов
// ---------------------------------------------------------------------------

/** План из БД (внутренний вид: со storagePath — только для сервиса). */
interface StudyPlanRow {
  readonly id: string;
  readonly teacherId: string;
  readonly title: string;
  readonly storagePath: string;
}

/**
 * Загружает учебный план преподавателя.
 *
 * Файл (.md/.txt, ≤1 МБ, текст UTF-8) уходит в приватное хранилище
 * (storage/study-plans/<teacherId>/), в базе остаётся запись StudyPlan
 * с относительным путём — публичных ссылок нет. План без текста
 * (только заголовок) отклоняется: отвечать по нему нечем.
 */
export async function uploadStudyPlan(
  session: AuthSession,
  input: UploadStudyPlanInput,
): Promise<StudyPlanListItem> {
  const { user, teacherId } = requireTeacher(session);

  const parsed = studyPlanUploadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные плана.', firstIssues(parsed.error));
  }
  const { title, fileName, mime, buffer } = parsed.data;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ValidationError('INVALID_INPUT', 'Файл должен быть текстом в кодировке UTF-8.');
  }
  if (text.trim() === '') {
    throw new ValidationError('INVALID_INPUT', 'Файл плана пустой.');
  }
  if (buffer.byteLength > MAX_STUDY_PLAN_SIZE_BYTES) {
    throw new ValidationError(
      'INVALID_INPUT',
      `Размер плана не должен превышать ${MAX_STUDY_PLAN_SIZE_BYTES / 1024 / 1024} МБ.`,
    );
  }

  const chunks = buildPlanChunks(parseStudyPlanSections(text));
  if (chunks.length === 0) {
    throw new ValidationError(
      'INVALID_INPUT',
      'В плане нет текста: нужны заголовки (#) и абзацы с темами.',
    );
  }

  let storagePath: string;
  try {
    storagePath = await saveStudyPlan(teacherId, buffer, mime);
  } catch (error) {
    // Ошибки хранилища (тип, размер) — проблема входных данных: текст
    // сообщения от хранилища понятен пользователю, наружу его отдаёт маршрут.
    if (error instanceof IdCardStorageError) {
      throw new ValidationError('INVALID_INPUT', error.message);
    }
    throw error;
  }
  const plan = await prisma().studyPlan.create({
    data: { teacherId, title, fileName, mime, sizeBytes: buffer.byteLength, storagePath },
    select: { id: true, title: true, fileName: true, mime: true, sizeBytes: true, uploadedAt: true },
  });

  await writeAuditEvent({
    actorUserId: user.id,
    action: 'studyPlan.upload',
    entity: 'StudyPlan',
    entityId: plan.id,
    meta: { title, sizeBytes: plan.sizeBytes },
  });

  return plan;
}

/** Свои планы, свежие сверху. storagePath не покидает сервер. */
export async function listMyStudyPlans(session: AuthSession): Promise<readonly StudyPlanListItem[]> {
  const { teacherId } = requireTeacher(session);
  return prisma().studyPlan.findMany({
    where: { teacherId },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, title: true, fileName: true, mime: true, sizeBytes: true, uploadedAt: true },
  });
}

/** Загружает свой план: чужой или несуществующий → NOT_OWNER (404-как NOT_FOUND). */
async function loadOwnPlan(teacherId: string, planId: string): Promise<StudyPlanRow> {
  const plan = await prisma().studyPlan.findUnique({
    where: { id: planId },
    select: { id: true, teacherId: true, title: true, storagePath: true },
  });
  if (plan === null || plan.teacherId !== teacherId) {
    throw new OwnershipError('NOT_OWNER', 'Учебный план не найден или недоступен.');
  }
  return plan;
}

/**
 * Удаляет свой план: запись из БД и файл из приватного хранилища.
 * Чужой план → NOT_OWNER: ответ не отличается от «не существует».
 */
export async function deleteStudyPlan(session: AuthSession, planId: string): Promise<void> {
  const { user, teacherId } = requireTeacher(session);
  if (typeof planId !== 'string' || !UUID.test(planId)) {
    throw new OwnershipError('NOT_OWNER', 'Учебный план не найден или недоступен.');
  }

  const plan = await loadOwnPlan(teacherId, planId);
  await prisma().studyPlan.delete({ where: { id: plan.id } });

  try {
    await deleteStudyPlanFile(plan.storagePath);
  } catch {
    // Удаление файла — лучшее усилие: запись уже удалена, осиротевший
    // файл в приватном хранилище ничего не раскрывает.
  }

  await writeAuditEvent({
    actorUserId: user.id,
    action: 'studyPlan.delete',
    entity: 'StudyPlan',
    entityId: plan.id,
    meta: null,
  });
}

// ---------------------------------------------------------------------------
// Ответ ассистента преподавателя
// ---------------------------------------------------------------------------

/**
 * Ответ ассистента преподавателя по учебному плану.
 *
 * План: переданный planId (свой — иначе NOT_OWNER) или самый свежий
 * план преподавателя. Ответ детерминированный: цитаты из релевантных
 * разделов плана + сопоставление с долгами студентов его групп. LLM,
 * если клиент передан, только переформулирует ответ по тем же чанкам;
 * ошибка или таймаут → детерминированный ответ с пометкой.
 * файл плана пропал → честный ответ "загрузите заново", а не ошибка хранилища.
 */
export async function askStudyPlanAssistant(
  session: AuthSession,
  input: AskStudyPlanAssistantInput,
  options: AskStudyPlanAssistantOptions = {},
): Promise<StudyPlanAssistantAnswer> {
  const { teacherId } = requireTeacher(session);

  const parsed = studyPlanQuestionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный вопрос.', firstIssues(parsed.error));
  }
  const { question, planId } = parsed.data;

  const plan =
    planId === undefined
      ? await prisma().studyPlan.findFirst({
          where: { teacherId },
          orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
          select: { id: true, teacherId: true, title: true, storagePath: true },
        })
      : await loadOwnPlan(teacherId, planId);

  if (plan === null) {
    return {
      answer: NO_PLAN_ANSWER,
      mode: 'deterministic',
      citations: [],
      suggestions: TEACHER_ASSISTANT_STARTER_QUESTIONS,
      plan: null,
    };
  }

  let text: string;
  try {
    text = (await readStudyPlan(plan.storagePath)).toString('utf8');
  } catch (error) {
    // Запись плана есть, а файл пропал (ручная правка хранилища, сбой
    // диска). Преподаватель ничего не загружал, поэтому ошибка чтения
    // не должна уходить наверх как «файл не принят»: отвечаем честно и
    // просим загрузить план заново. В лог — только текст ошибки.
    console.warn(
      '[study-plan] файл плана недоступен:',
      error instanceof Error ? error.message : error,
    );
    return {
      answer: PLAN_UNAVAILABLE_ANSWER,
      mode: 'deterministic',
      citations: [],
      suggestions: TEACHER_ASSISTANT_STARTER_QUESTIONS,
      plan: { id: plan.id, title: plan.title },
    };
  }
  const index = buildStudyPlanIndex(buildPlanChunks(parseStudyPlanSections(text)));
  const retrieved = retrieveChunks(index, question, TOP_CHUNKS);
  // Долги грузим только когда есть что сопоставлять: без релевантных
  // разделов ответ «в плане не найдено», и лишний запрос не нужен.
  const debts =
    retrieved.length === 0
      ? []
      : debtsForAnswer(await loadTeacherDebts(teacherId), tokenizePlanText(question), retrieved);

  const deterministic: StudyPlanAssistantAnswer = {
    answer: renderAnswer(plan.title, retrieved, debts, index),
    mode: 'deterministic',
    citations: retrieved.map((item) => ({
      section: item.chunk.section === '' ? PREAMBLE_SECTION : item.chunk.section,
      score: score2(item.score),
    })),
    suggestions: TEACHER_ASSISTANT_STARTER_QUESTIONS,
    plan: { id: plan.id, title: plan.title },
  };

  const llm = options.llm ?? null;
  // Нечего переформулировывать: «в плане не найдено» и «загрузите план» —
  // ответы без данных, врать модели не на чем.
  if (llm === null || retrieved.length === 0) {
    return deterministic;
  }

  try {
    const text = await llm.complete({
      system: TEACHER_ASSISTANT_SYSTEM_PROMPT,
      user: buildLlmContext(plan.title, question, retrieved),
    });
    const answer = text.trim().slice(0, MAX_ANSWER_LENGTH);
    if (answer === '') {
      return deterministic;
    }
    return { ...deterministic, answer, mode: 'llm' };
  } catch (error) {
    // Ошибка/таймаут LLM → детерминированный ответ с пометкой.
    // В лог уходит только текст ошибки: заголовки (и ключ) в него не входят.
    console.warn('[study-plan] LLM недоступен:', error instanceof Error ? error.message : error);
    return {
      ...deterministic,
      answer: `${deterministic.answer}\n${FALLBACK_NOTE}`,
    };
  }
}

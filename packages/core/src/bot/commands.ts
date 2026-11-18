/**
 * Маршрутизатор команд каналов доступа (BRIEF v3): Telegram / VK / MAX.
 *
 * ГЛАВНОЕ ПРАВИЛО: бот — тонкий адаптер, второй бизнес-логики здесь нет.
 * Каждая команда вызывает ТОТ ЖЕ сервис кабинета, что и страница сайта
 * (/api/* оборачивает те же функции), и получает те же проверки
 * владения: сервис сам резолвит студента из сессии, studentId снаружи не
 * принимается (ownership.ts).
 *
 * Что делает этот модуль и только он:
 * - разбирает текст команды канала;
 * - проверяет, что канал привязан к учётной записи (identity.ts);
 * - формирует короткие тексты ответов (минимализм BRIEF v4: одна мысль
 *   на строку, гейты и ошибки — одной строкой с действием).
 *
 * Про токены ботов, long-polling и сеть здесь нет ничего: адаптер канала
 * живёт вне ядра и вызывает handleBotCommand.
 */
import { CoreError } from '../errors';
import type { AuthSession } from '../session';
import { getMyAcademicSummary, getMyGrades } from '../services/grades';
import type { AcademicSummary, MyGradeEntry, MyGradesResult } from '../services/grades';
import {
  getMyScheduleToday,
  getMyScheduleWeek,
  WEEKDAY_LABELS,
  type ScheduleLesson,
} from '../services/schedule';
import { createMyRequest, getMyRequests } from '../services/requests';
import { createMySickLeave } from '../services/sickleave';
import { getMyNotifications } from '../services/notifications';
import { askAssistant } from '../services/assistant';
import { botSessionFor, consumeBotLinkCode, resolveChannelUser } from './identity';
import { MAX_BOT_REPLIES, type BotReply, type BotUpdate } from './protocol';

/** Максимум позиций в списке ответа (мессенджер не читает длинные стены). */
const MAX_LIST_ITEMS = 10;

/** Максимум символов текста заявки из канала. */
const MAX_REQUEST_TEXT = 1000;

/** Максимум символов причины болезни. */
const MAX_SICK_REASON = 500;

/** Максимум символов значения поля формы в списке заявок. */
const MAX_FIELD_SUMMARY = 60;

/** Максимум символов текста уведомления в ленте. */
const MAX_NOTIFICATION_BODY = 80;

/** Приглашение привязать аккаунт (канал ещё не связан с учётной записью). */
const LINK_REQUIRED_TEXT = 'Привяжите аккаунт: /link <код> из кабинета.';

/** Короткая помощь: полный список команд кабинета. */
const HELP_LINES: readonly string[] = [
  'Команды кабинета',
  '/schedule — расписание на сегодня',
  '/schedule week — расписание на неделю',
  '/grades — оценки',
  '/requests — мои заявки',
  '/request <текст> — новая заявка',
  '/sick <дата с> <дата по> [причина] — отметка «болею»',
  '/notifications — уведомления',
  '/assistant <вопрос> — помощник по учёбе',
  '/link <код> — привязать аккаунт',
];

/** Команды, требующие привязки канала. */
const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  '/help',
  '/schedule',
  '/grades',
  '/requests',
  '/request',
  '/sick',
  '/notifications',
  '/assistant',
]);

/**
 * Обрабатывает команду канала и возвращает сообщения для отправки.
 *
 * Никогда не бросает: любая ошибка превращается в одну строку ответа,
 * потому что каналу нужен текст, а не трассировка. Текст ошибки ядра
 * (#errors.ts) написан для человека и не раскрывает внутренностей.
 */
export async function handleBotCommand(update: BotUpdate): Promise<BotReply[]> {
  try {
    const replies = await route(update);
    return replies.slice(0, MAX_BOT_REPLIES);
  } catch (error) {
    return [reply(errorText(error))];
  }
}

async function route(update: BotUpdate): Promise<BotReply[]> {
  const parts = update.text.trim().split(/\s+/);
  const command = normalizeCommand(parts[0] ?? '');
  const args = parts.slice(1);

  if (command === '/start') {
    return [reply(await startText(update))];
  }

  if (command === '/link') {
    const code = args[0];
    if (code === undefined) {
      return [reply('Укажите код: /link <код>. Код показан в кабинете, раздел «Каналы».')];
    }
    const link = await consumeBotLinkCode(code, update.channel, update.channelUserId);
    return [
      reply(
        link.created
          ? 'Аккаунт привязан. Команды кабинета: /help'
          : 'Этот канал уже был привязан. Команды кабинета: /help',
      ),
    ];
  }

  if (!KNOWN_COMMANDS.has(command)) {
    return [reply(helpText())];
  }

  const userId = await resolveChannelUser(update.channel, update.channelUserId);
  if (userId === null) {
    return [reply(LINK_REQUIRED_TEXT)];
  }
  const session = await botSessionFor(userId, update.channel);

  switch (command) {
    case '/help':
      return [reply(helpText())];
    case '/schedule':
      return scheduleReplies(session, args[0]);
    case '/grades':
      return gradesReplies(session);
    case '/requests':
      return requestsReplies(session);
    case '/request':
      return requestReplies(session, args.join(' ').trim());
    case '/sick':
      return sickReplies(session, args);
    case '/notifications':
      return notificationsReplies(session);
    case '/assistant':
      return assistantReplies(session, args.join(' ').trim());
    default:
      return [reply(helpText())];
  }
}

/** Приветствие и статус привязки (единственная команда без привязки). */
async function startText(update: BotUpdate): Promise<string> {
  const userId = await resolveChannelUser(update.channel, update.channelUserId);
  const status =
    userId === null
      ? 'Аккаунт не привязан. Код показан в кабинете, раздел «Каналы» (/channels).'
      : 'Аккаунт привязан.';
  return ['Кабинет студента УдГУ', 'Все команды: /help', status].join('\n');
}

// ---------------------------------------------------------------------------
// Команды кабинета — вызовы тех же сервисов, что и у сайта
// ---------------------------------------------------------------------------

async function scheduleReplies(session: AuthSession, argument: string | undefined): Promise<BotReply[]> {
  if (argument === 'week') {
    const week = await getMyScheduleWeek(session);
    const replies: BotReply[] = [];
    for (const day of week.days) {
      if (day.lessons.length === 0) {
        continue;
      }
      const lines = [dayLabel(day.date), ...day.lessons.slice(0, MAX_LIST_ITEMS).map(lessonLine)];
      replies.push(reply(lines.join('\n')));
    }
    return replies.length === 0 ? [reply('На неделе занятий нет.')] : replies;
  }

  const lessons = await getMyScheduleToday(session);
  if (lessons.length === 0) {
    return [reply('Занятий на сегодня нет.')];
  }
  const header = `Сегодня · ${dayLabel(new Date())}`;
  return [reply([header, ...lessons.slice(0, MAX_LIST_ITEMS).map(lessonLine)].join('\n'))];
}

async function gradesReplies(session: AuthSession): Promise<BotReply[]> {
  let grades: MyGradesResult;
  let summary: AcademicSummary;
  try {
    grades = await getMyGrades(session);
    summary = await getMyAcademicSummary(session);
  } catch (error) {
    if (error instanceof CoreError && error.code === 'VERIFICATION_REQUIRED') {
      return [
        reply('Оценки открываются после верификации студбилета. Пройдите верификацию в кабинете.'),
      ];
    }
    throw error;
  }

  const total = grades.semesters.reduce((sum, semester) => sum + semester.entries.length, 0);
  if (total === 0) {
    return [reply('Оценок пока нет.')];
  }

  const lines: string[] = [];
  lines.push(
    summary.averageScore === null ? 'Оценки' : `Оценки · средний балл ${formatScore(summary.averageScore)}`,
  );
  // Семестр — заголовком, как в кабинете: одна дисциплина может встречаться
  // в разных семестрах, и без семестра записи выглядят дублями.
  let shown = 0;
  let currentSemester: number | null = null;
  for (const semester of grades.semesters) {
    for (const entry of semester.entries) {
      if (shown >= MAX_LIST_ITEMS) {
        break;
      }
      if (semester.semester !== currentSemester) {
        lines.push(`${semester.semester} семестр`);
        currentSemester = semester.semester;
      }
      lines.push(`${gradeValue(entry)} ${entry.subjectName} · ${entry.typeLabel.toLowerCase()}`);
      shown += 1;
    }
  }
  if (total > shown) {
    lines.push(`и ещё ${total - shown}`);
  }
  if (summary.debts.length > 0) {
    lines.push(`Долги: ${summary.debts.slice(0, MAX_LIST_ITEMS).map((debt) => debt.subjectName).join(', ')}`);
  }
  return [reply(lines.join('\n'))];
}

async function requestsReplies(session: AuthSession): Promise<BotReply[]> {
  const requests = await getMyRequests(session);
  if (requests.length === 0) {
    return [reply('Заявок нет. Новая заявка: /request <текст>')];
  }
  const lines = [`Заявок: ${requests.length}`];
  for (const request of requests.slice(0, MAX_LIST_ITEMS)) {
    lines.push(
      `${request.typeLabel} · ${request.statusLabel.toLowerCase()} · ${shortDate(request.createdAt)}`,
    );
    const summary = formSummary(request.formData);
    if (summary !== '') {
      lines.push(`  ${summary}`);
    }
  }
  if (requests.length > MAX_LIST_ITEMS) {
    lines.push(`и ещё ${requests.length - MAX_LIST_ITEMS}`);
  }
  return [reply(lines.join('\n'))];
}

async function requestReplies(
  session: AuthSession,
  text: string,
): Promise<BotReply[]> {
  if (text === '') {
    return [reply('Укажите текст: /request <текст>. Например: /request справка об обучении')];
  }
  if (text.length > MAX_REQUEST_TEXT) {
    return [reply(`Текст заявки длиннее ${MAX_REQUEST_TEXT} символов. Сократите его.`)];
  }

  // Справка отличается словом «справка» — полная форма (способ получения,
  // семестр) остаётся в кабинете, бот создаёт заявку тем же сервисом.
  // Граница слова — пробел или конец строки: \b в JS не понимает кириллицу.
  const wantsReference = /^справка(\s|$)/i.test(text);
  const request = wantsReference
    ? await createMyRequest(session, {
        type: 'REFERENCE',
        formData: { purpose: text.replace(/^справка\s*/i, '').trim() || text },
      })
    : await createMyRequest(session, {
        type: 'APPLICATION',
        formData: { topic: truncate(text, MAX_FIELD_SUMMARY), body: text },
      });

  return [reply(`${request.typeLabel} создана · ${request.statusLabel.toLowerCase()}`)];
}

async function sickReplies(
  session: AuthSession,
  args: readonly string[],
): Promise<BotReply[]> {
  const dateFrom = args[0];
  const dateTo = args[1];
  if (dateFrom === undefined || dateTo === undefined || !isDateKey(dateFrom) || !isDateKey(dateTo)) {
    return [reply('Формат: /sick 2026-11-18 2026-11-20 [причина]')];
  }
  const reason = args.slice(2).join(' ').trim();

  const leave = await createMySickLeave(session, {
    dateFrom,
    dateTo,
    reason: reason === '' ? undefined : truncate(reason, MAX_SICK_REASON),
  });
  return [reply(`Отметка «болею» создана: ${shortDate(leave.dateFrom)} — ${shortDate(leave.dateTo)}`)];
}

async function notificationsReplies(session: AuthSession): Promise<BotReply[]> {
  const notifications = await getMyNotifications(session);
  if (notifications.length === 0) {
    return [reply('Уведомлений нет.')];
  }
  const unread = notifications.filter((notification) => !notification.read).length;
  const lines = [unread === 0 ? 'Уведомления' : `Уведомления · новых ${unread}`, '• — новое'];
  for (const notification of notifications.slice(0, MAX_LIST_ITEMS)) {
    const mark = notification.read ? '' : '• ';
    lines.push(`${mark}${notification.title}`);
    lines.push(`  ${truncate(notification.body, MAX_NOTIFICATION_BODY)}`);
  }
  if (notifications.length > MAX_LIST_ITEMS) {
    lines.push(`и ещё ${notifications.length - MAX_LIST_ITEMS}`);
  }
  return [reply(lines.join('\n'))];
}

async function assistantReplies(session: AuthSession, question: string): Promise<BotReply[]> {
  if (question === '') {
    return [reply('Задайте вопрос: /assistant <вопрос>. Например: /assistant какие у меня долги?')];
  }
  // LLM не передаём: в канале ответ всегда детерминированный движок по
  // данным владельца сессии (ключи LLM — только env сервера).
  const answer = await askAssistant(session, question);
  return [reply(answer.answer)];
}

// ---------------------------------------------------------------------------
// Форматирование (минимализм BRIEF v4: короткие строки, одна мысль на строку)
// ---------------------------------------------------------------------------

function reply(text: string): BotReply {
  return { text };
}

/** Текст помощи (одна мысль на строку — читается в мессенджере). */
function helpText(): string {
  return HELP_LINES.join('\n');
}

/** Команда в нижнем регистре и без @имени_бота (мессенджеры его добавляют). */
function normalizeCommand(raw: string): string {
  const withoutBotName = raw.split('@')[0] ?? '';
  return withoutBotName.toLowerCase();
}

/** Занятие одной строкой: время, предмет, аудитория, отметка изменения. */
function lessonLine(lesson: ScheduleLesson): string {
  const change = lesson.changeHint === null ? '' : ` · ${lesson.changeHint}`;
  return `${lesson.startTime}–${lesson.endTime} ${lesson.subjectName} · ${lesson.room}${change}`;
}

/** День недели и дата: «Ср 18.11». */
function dayLabel(date: Date): string {
  const weekday = WEEKDAY_LABELS[(date.getUTCDay() + 6) % 7] ?? '';
  return `${weekday} ${shortDate(date)}`;
}

/** Дата в формате 18.11. */
function shortDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

/**
 * Оценка так же, как её показывает кабинет (grades-screen.tsx): зачёт —
 * «зачтено/не зачтено», экзамен и курсовая без оценки — «оценки ещё нет».
 * Одна и та же запись БД не должна выглядеть в боте иначе, чем на сайте.
 */
function gradeValue(entry: MyGradeEntry): string {
  if (entry.type === 'CREDIT') {
    return entry.passed === true ? 'зачтено' : 'не зачтено';
  }
  return entry.value === null ? 'оценки ещё нет' : String(entry.value);
}

function formatScore(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Поля формы заявки одной строкой (прототип: бот создаёт те же записи, что и сайт). */
function formSummary(formData: Record<string, string>): string {
  return Object.entries(formData)
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${truncate(value, MAX_FIELD_SUMMARY)}`)
    .join(' · ');
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function truncate(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/** Текст ошибки для канала: сообщение ядра или нейтральная строка. */
function errorText(error: unknown): string {
  if (error instanceof CoreError) {
    return error.message;
  }
  return 'Не удалось выполнить команду. Попробуйте позже.';
}

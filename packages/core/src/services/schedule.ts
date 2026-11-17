/**
 * Расписание: своя группа (сегодня/неделя), ближайшая пара, свободные
 * окна, расписание преподавателей и часы приёма.
 *
 * Все функции «мои» принимают сессию и резолвят группу сами — группу
 * невозможно подменить извне (правило ownership.ts).
 *
 * Расписание преподавателей и часы приёма — общедоступная информация
 * кабинета студента (требование BRIEF v2): студенту нужно понимать,
 * когда можно подойти к преподавателю. Идентификатор преподавателя
 * здесь НЕ является идентификатором владельца данных, поэтому проверка
 * владения для него не применяется — только валидность ссылки.
 *
 * Даты расписания хранятся как @db.Date в полночи UTC (так их пишет
 * сидер), поэтому все границы дней считаются в UTC. Часовой пояс
 * пользователя — задача слоя API/UI (P1.4).
 *
 * Два взгляда на расписание (осознанно):
 * - «Сегодня» и «неделя» показывают сетку как опубликована: пара с
 *   статусом MOVED остаётся в исходном слоте с заметной отметкой
 *   «перенесено на …», CANCELLED — с причиной;
 * - «Ближайшая пара» и «свободные окна» считают ФАКТИЧЕСКИЕ занятия:
 *   перенесённая пара занимает слот на новой дате, исходный освобождает.
 */
import { prisma } from '../db';
import { requireStudent } from '../ownership';
import { ValidationError } from '../errors';
import type { AuthSession } from '../session';
import type { ScheduleStatus, ScheduleType, OfficeHourType } from '@udgu/db';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Метки типов занятий (для UI; статус дублируется текстом, не только цветом). */
export const SCHEDULE_TYPE_LABELS: Readonly<Record<ScheduleType, string>> = {
  LECTURE: 'Лекция',
  SEMINAR: 'Семинар',
  LAB: 'Лабораторная',
};

/** Метки статусов пар. */
export const SCHEDULE_STATUS_LABELS: Readonly<Record<ScheduleStatus, string>> = {
  SCHEDULED: 'Запланировано',
  MOVED: 'Перенесено',
  CANCELLED: 'Отменено',
};

/** Метки типов часов приёма. */
export const OFFICE_HOUR_TYPE_LABELS: Readonly<Record<OfficeHourType, string>> = {
  CONSULTATION: 'Консультация',
  RECEPTION: 'Час приёма',
  EXTRA_CLASS: 'Дополнительное занятие',
};

/** Дни недели: 1 — понедельник (как в БД office_hours.weekday). */
export const WEEKDAY_LABELS: readonly string[] = [
  'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс',
];

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Ключ даты YYYY-MM-DD (уникальный индекс для @db.Date). */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Понедельник недели, содержащей date, со смещением weekOffset недель. */
export function mondayOfUtcWeek(date: Date, weekOffset = 0): Date {
  const day = startOfUtcDay(date);
  const weekday = (day.getUTCDay() + 6) % 7; // 0 — понедельник
  return addUtcDays(day, -weekday + weekOffset * 7);
}

/** Минуты от полночи для времени «HH:MM». */
function minutesOfTime(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function teacherFullName(teacher: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}): string {
  return teacher.middleName === null
    ? `${teacher.lastName} ${teacher.firstName}`
    : `${teacher.lastName} ${teacher.firstName} ${teacher.middleName}`;
}

/** Занятие в DTO кабинета: заметная отметка переноса/отмены с причиной. */
export interface ScheduleLesson {
  readonly id: string;
  readonly date: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
  readonly type: ScheduleType;
  readonly typeLabel: string;
  readonly status: ScheduleStatus;
  readonly statusLabel: string;
  readonly subjectName: string;
  readonly subjectCode: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly note: string | null;
  readonly movedToDate: Date | null;
  readonly movedToRoom: string | null;
  /** Человекочитаемая причина изменения (null для SCHEDULED). */
  readonly changeHint: string | null;
}

/** Слот с датой и аудиторией, где занятие реально состоится. */
export interface LessonOccurrence extends ScheduleLesson {
  readonly effectiveDate: Date;
  readonly effectiveRoom: string;
  readonly effectiveStart: Date;
}

function changeHintOf(entry: {
  status: ScheduleStatus;
  note: string | null;
  movedToDate: Date | null;
  movedToRoom: string | null;
}): string | null {
  if (entry.status === 'MOVED') {
    const where =
      entry.movedToDate !== null
        ? ` на ${dateKey(entry.movedToDate)}${entry.movedToRoom !== null ? `, аудитория ${entry.movedToRoom}` : ''}`
        : '';
    const base = `Перенесено${where}.`;
    return entry.note !== null && entry.note !== '' ? `${base} ${entry.note}` : base;
  }
  if (entry.status === 'CANCELLED') {
    return entry.note !== null && entry.note !== '' ? entry.note : 'Занятие отменено.';
  }
  return null;
}

type ScheduleRow = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  room: string;
  type: ScheduleType;
  status: ScheduleStatus;
  note: string | null;
  movedToDate: Date | null;
  movedToRoom: string | null;
  subject: { name: string; code: string };
  teacher: { id: string; lastName: string; firstName: string; middleName: string | null };
};

function toLesson(row: ScheduleRow): ScheduleLesson {
  return {
    id: row.id,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    room: row.room,
    type: row.type,
    typeLabel: SCHEDULE_TYPE_LABELS[row.type],
    status: row.status,
    statusLabel: SCHEDULE_STATUS_LABELS[row.status],
    subjectName: row.subject.name,
    subjectCode: row.subject.code,
    teacherId: row.teacher.id,
    teacherName: teacherFullName(row.teacher),
    note: row.note,
    movedToDate: row.movedToDate,
    movedToRoom: row.movedToRoom,
    changeHint: changeHintOf(row),
  };
}

const SCHEDULE_INCLUDE = {
  subject: { select: { name: true, code: true } },
  teacher: { select: { id: true, lastName: true, firstName: true, middleName: true } },
} as const;

/** Расписание группы студента за период [from, to) по дате. */
async function lessonsForGroup(
  groupId: string,
  from: Date,
  to: Date,
): Promise<ScheduleLesson[]> {
  const rows = await prisma().scheduleEntry.findMany({
    where: { groupId, date: { gte: from, lt: to } },
    include: SCHEDULE_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  return rows.map(toLesson);
}

/** Расписание своей группы на дату (по умолчанию — сегодня, UTC). */
export async function getMyScheduleToday(
  session: AuthSession,
  date: Date = new Date(),
): Promise<ScheduleLesson[]> {
  const { groupId } = await requireStudentWithGroup(session);
  const day = startOfUtcDay(date);
  return lessonsForGroup(groupId, day, addUtcDays(day, 1));
}

export interface ScheduleDay {
  readonly date: Date;
  /** 1 — понедельник … 7 — воскресенье. */
  readonly weekday: number;
  readonly lessons: readonly ScheduleLesson[];
}

export interface ScheduleWeek {
  readonly weekStart: Date;
  readonly weekEnd: Date;
  readonly days: readonly ScheduleDay[];
}

/**
 * Расписание своей группы на неделю. weekOffset=0 — текущая неделя,
 * 1 — следующая, -1 — предыдущая. Возвращаются все 7 дней (в том числе
 * пустые) — UI рисует сетку недели без дополнительных запросов.
 */
export async function getMyScheduleWeek(
  session: AuthSession,
  weekOffset = 0,
): Promise<ScheduleWeek> {
  const { groupId } = await requireStudentWithGroup(session);
  const weekStart = mondayOfUtcWeek(new Date(), weekOffset);
  const weekEnd = addUtcDays(weekStart, 7);

  const lessons = await lessonsForGroup(groupId, weekStart, weekEnd);
  const byDate = new Map<string, ScheduleLesson[]>();
  for (const lesson of lessons) {
    const key = dateKey(lesson.date);
    const list = byDate.get(key) ?? [];
    list.push(lesson);
    byDate.set(key, list);
  }

  const days: ScheduleDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addUtcDays(weekStart, offset);
    days.push({
      date,
      weekday: offset + 1,
      lessons: byDate.get(dateKey(date)) ?? [],
    });
  }

  return { weekStart, weekEnd, days };
}

/**
 * Ближайшая пара студента (своя группа). MOVED считается по новой дате
 * и новой аудитории, CANCELLED — пропускается. Окно поиска — 14 дней
 * (горизонт сидера); при отсутствии пар возвращает null.
 */
export async function getMyNextLesson(
  session: AuthSession,
  now: Date = new Date(),
): Promise<LessonOccurrence | null> {
  const { groupId } = await requireStudentWithGroup(session);
  const from = startOfUtcDay(now);
  const to = addUtcDays(from, 14);

  const lessons = await lessonsForGroup(groupId, from, to);
  const upcoming = lessons
    .filter((lesson) => lesson.status !== 'CANCELLED')
    .map((lesson) => ({ lesson, occurrence: toOccurrence(lesson) }))
    .filter(({ occurrence }) => occurrence.effectiveStart.getTime() > now.getTime())
    .sort((left, right) => left.occurrence.effectiveStart.getTime() - right.occurrence.effectiveStart.getTime());

  return upcoming[0]?.occurrence ?? null;
}

function toOccurrence(lesson: ScheduleLesson): LessonOccurrence {
  const effectiveDate = lesson.movedToDate ?? lesson.date;
  const effectiveRoom = lesson.movedToRoom ?? lesson.room;
  const [hours, minutes] = lesson.startTime.split(':');
  const effectiveStart = new Date(
    Date.UTC(
      effectiveDate.getUTCFullYear(),
      effectiveDate.getUTCMonth(),
      effectiveDate.getUTCDate(),
      Number(hours),
      Number(minutes),
    ),
  );
  return { ...lesson, effectiveDate, effectiveRoom, effectiveStart };
}

export interface FreeGap {
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMinutes: number;
}

/**
 * Свободные окна между парами своей группы за дату (решение Council:
 * «свободные окна между парами», упрощённо).
 *
 * Учитываются ФАКТИЧЕСКИЕ занятия дня: пара, перенесённая НА эту дату,
 * занимает слот; пара, перенесённая С этой даты, слот освобождает;
 * отменённая не занимает ничего. Окна считаются только между занятиями —
 * до первой и после последней пары не выводятся.
 */
export async function getFreeGaps(session: AuthSession, date: Date = new Date()): Promise<FreeGap[]> {
  const { groupId } = await requireStudentWithGroup(session);
  const day = startOfUtcDay(date);

  const rows = await prisma().scheduleEntry.findMany({
    where: {
      groupId,
      OR: [
        { date: day, status: { notIn: ['MOVED', 'CANCELLED'] } },
        { movedToDate: day, status: 'MOVED' },
      ],
    },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });

  const gaps: FreeGap[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const previousEnd = minutesOfTime(previous.endTime);
    const currentStart = minutesOfTime(current.startTime);
    if (currentStart > previousEnd) {
      gaps.push({
        startTime: previous.endTime,
        endTime: current.startTime,
        durationMinutes: currentStart - previousEnd,
      });
    }
  }
  return gaps;
}

export interface TeacherLesson extends ScheduleLesson {
  readonly groupName: string;
}

/**
 * Расписание преподавателя за период [dateFrom, dateTo] включительно.
 * Доступно студенту (BRIEF v2): понять, когда преподаватель занят парами.
 */
export async function getTeacherSchedule(
  teacherId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<TeacherLesson[]> {
  if (typeof teacherId !== 'string' || teacherId === '') {
    throw new TypeError('teacherId обязателен.');
  }
  const from = startOfUtcDay(dateFrom);
  const to = addUtcDays(startOfUtcDay(dateTo), 1);

  const rows = await prisma().scheduleEntry.findMany({
    where: { teacherId, date: { gte: from, lt: to } },
    include: {
      ...SCHEDULE_INCLUDE,
      group: { select: { name: true } },
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  return rows.map((row) => ({ ...toLesson(row), groupName: row.group.name }));
}

export interface TeacherOfficeHour {
  readonly id: string;
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
  readonly type: OfficeHourType;
  readonly typeLabel: string;
  readonly note: string | null;
  readonly teacherName: string;
}

/**
 * Часы приёма и консультации преподавателя (BRIEF v2): студент видит,
 * когда можно подойти. Доступно без проверки владения — общедоступная
 * информация кабинета.
 */
export async function getTeacherOfficeHours(teacherId: string): Promise<TeacherOfficeHour[]> {
  if (typeof teacherId !== 'string' || teacherId === '') {
    throw new TypeError('teacherId обязателен.');
  }

  const rows = await prisma().officeHour.findMany({
    where: { teacherId },
    include: {
      teacher: { select: { lastName: true, firstName: true, middleName: true } },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    weekdayLabel: WEEKDAY_LABELS[row.weekday - 1] ?? '',
    startTime: row.startTime,
    endTime: row.endTime,
    room: row.room,
    type: row.type,
    typeLabel: OFFICE_HOUR_TYPE_LABELS[row.type],
    note: row.note,
    teacherName: teacherFullName(row.teacher),
  }));
}

/** Резолвит группу студента сессии: без группы расписание невозможно. */
async function requireStudentWithGroup(session: AuthSession): Promise<{ groupId: string }> {
  const { studentId } = requireStudent(session);
  const student = await prisma().student.findUnique({
    where: { id: studentId },
    select: { groupId: true },
  });
  if (student === null) {
    throw new ValidationError('NOT_FOUND', 'Профиль студента не найден. Обратитесь в деканат.');
  }
  return { groupId: student.groupId };
}

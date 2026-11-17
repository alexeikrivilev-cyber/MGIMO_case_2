/**
 * Расписание в кабинете сотрудника деканата: пары групп своего факультета,
 * перенос и отмена занятия (BRIEF v2 §6, ARCHITECTURE §4).
 *
 * Владение: сотрудник управляет расписанием ТОЛЬКО групп своего факультета.
 * Пара чужого факультета по идентификатору → NOT_OWNER (→ 404: ответ не
 * отличается от «не существует»). ADMIN — все факультеты.
 *
 * Даты — @db.Date в полночь UTC (как их пишет сидер), поэтому границы
 * периода считаются в UTC (startOfUtcDay/addUtcDays из services/schedule).
 *
 * Каждая мутация: уведомление студентам группы (type SCHEDULE_CHANGE) +
 * аудит (actor = сотрудник сессии).
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStaffScope, type StaffScope } from './staff-scope';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import { dateKey, addUtcDays, startOfUtcDay, SCHEDULE_TYPE_LABELS, SCHEDULE_STATUS_LABELS } from './schedule';
import type { AuthSession } from '../session';
import type { ScheduleStatus, ScheduleType } from '@udgu/db';

/** Статусы, из которых пару ещё можно переносить/отменять. */
const CHANGEABLE_STATUSES: readonly ScheduleStatus[] = ['SCHEDULED', 'MOVED'];

/** Схема периода расписания (query ?from&to, YYYY-MM-DD). */
export const staffScheduleRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата начала в формате YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата окончания в формате YYYY-MM-DD'),
});

export type StaffScheduleRange = z.infer<typeof staffScheduleRangeSchema>;

/** Схема переноса пары. */
export const staffLessonMoveSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Новая дата в формате YYYY-MM-DD'),
  room: z.string().trim().max(50, 'Номер аудитории слишком длинный.').optional(),
  note: z.string().trim().max(500, 'Примечание слишком длинное (максимум 500 символов).').optional(),
});

export type StaffLessonMoveInput = z.infer<typeof staffLessonMoveSchema>;

/** Схема отмены пары: причина обязательна (студенты должны знать зачем). */
export const staffLessonCancelSchema = z.object({
  reason: z.string().trim().min(1, 'Укажите причину отмены.').max(500, 'Причина слишком длинная (максимум 500 символов).'),
});

export type StaffLessonCancelInput = z.infer<typeof staffLessonCancelSchema>;

/** Пара в расписании сотрудника: с группой, предметом и преподавателем. */
export interface StaffLessonItem {
  readonly id: string;
  readonly date: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
  readonly type: ScheduleType;
  readonly typeLabel: string;
  readonly status: ScheduleStatus;
  readonly statusLabel: string;
  readonly note: string | null;
  readonly movedToDate: Date | null;
  readonly movedToRoom: string | null;
  readonly subjectName: string;
  readonly subjectCode: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly teacherName: string;
}

const LESSON_INCLUDE = {
  group: { select: { name: true } },
  subject: { select: { name: true, code: true } },
  teacher: { select: { lastName: true, firstName: true, middleName: true } },
} as const;

function teacherFullName(teacher: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}): string {
  return teacher.middleName === null
    ? `${teacher.lastName} ${teacher.firstName}`
    : `${teacher.lastName} ${teacher.firstName} ${teacher.middleName}`;
}

type LessonRow = {
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
  group: { name: string };
  subject: { name: string; code: string };
  teacher: { lastName: string; firstName: string; middleName: string | null };
};

function toLessonItem(row: LessonRow & { groupId: string }): StaffLessonItem {
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
    note: row.note,
    movedToDate: row.movedToDate,
    movedToRoom: row.movedToRoom,
    subjectName: row.subject.name,
    subjectCode: row.subject.code,
    groupId: row.groupId,
    groupName: row.group.name,
    teacherName: teacherFullName(row.teacher),
  };
}

/** Группы факультета сотрудника (пустой фильтр = все группы для ADMIN). */
function groupFilter(scope: StaffScope): { faculty: string } | Record<string, never> {
  return scope.allFaculties ? {} : { faculty: scope.faculty as string };
}

/** Расписание групп факультета сотрудника за период [from, to] включительно. */
export async function listStaffSchedule(
  session: AuthSession,
  range: StaffScheduleRange,
): Promise<StaffLessonItem[]> {
  const scope = requireStaffScope(session);
  const parsed = staffScheduleRangeSchema.safeParse(range);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный период расписания.', firstIssues(parsed.error));
  }
  const from = startOfUtcDay(new Date(`${parsed.data.from}T00:00:00.000Z`));
  const to = addUtcDays(startOfUtcDay(new Date(`${parsed.data.to}T00:00:00.000Z`)), 1);
  if (from.getTime() > to.getTime()) {
    throw new ValidationError('INVALID_INPUT', 'Дата начала не может быть позже даты окончания.');
  }

  const rows = await prisma().scheduleEntry.findMany({
    where: { group: groupFilter(scope), date: { gte: from, lt: to } },
    include: LESSON_INCLUDE,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  return rows.map((row) => toLessonItem({ ...row, groupId: row.groupId }));
}

/** Загружает пару и проверяет, что её группа — факультета сотрудника. */
async function loadLessonInScope(
  scope: StaffScope,
  entryId: string,
): Promise<LessonRow & { groupId: string }> {
  if (typeof entryId !== 'string' || entryId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор занятия не указан.');
  }
  const entry = await prisma().scheduleEntry.findUnique({
    where: { id: entryId },
    include: { ...LESSON_INCLUDE, group: { select: { name: true, faculty: true } } },
  });
  // Единый ответ для «не существует» и «чужой факультет» (NOT_OWNER → 404).
  if (entry === null || (scope.allFaculties === false && entry.group.faculty !== scope.faculty)) {
    throw new OwnershipError('NOT_OWNER', 'Занятие не найдено или недоступно.');
  }
  return entry as LessonRow & { groupId: string };
}

/** Уведомление студентам группы об изменении расписания. */
async function notifyGroup(
  groupId: string,
  title: string,
  body: string,
): Promise<void> {
  const students = await prisma().student.findMany({
    where: { groupId },
    select: { userId: true },
  });
  if (students.length === 0) {
    return;
  }
  await prisma().notification.createMany({
    data: students.map((student) => ({
      userId: student.userId,
      type: 'SCHEDULE_CHANGE' as const,
      title,
      body,
      link: '/schedule',
    })),
  });
}

/**
 * Переносит пару: статус MOVED + movedToDate/movedToRoom. Исходный слот
 * остаётся в сетке с отметкой «перенесено» (так же его видит студент),
 * фактическое занятие считается по новой дате.
 */
export async function moveStaffLesson(
  session: AuthSession,
  entryId: string,
  input: StaffLessonMoveInput,
): Promise<StaffLessonItem> {
  const scope = requireStaffScope(session);
  const parsed = staffLessonMoveSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные переноса.', firstIssues(parsed.error));
  }
  const { date, room, note } = parsed.data;

  const entry = await loadLessonInScope(scope, entryId);
  if (!CHANGEABLE_STATUSES.includes(entry.status)) {
    throw new ValidationError(
      'CONFLICT',
      `Занятие уже ${SCHEDULE_STATUS_LABELS[entry.status].toLowerCase()}: изменение невозможно.`,
    );
  }

  const movedToDate = startOfUtcDay(new Date(`${date}T00:00:00.000Z`));

  const updated = await prisma().scheduleEntry.update({
    where: { id: entry.id },
    data: {
      status: 'MOVED',
      movedToDate,
      movedToRoom: room?.trim() || null,
      note: note?.trim() || null,
    },
    include: LESSON_INCLUDE,
  });

  await notifyGroup(
    entry.groupId,
    'Пара перенесена',
    `${entry.subject.name} (${entry.group.name}) ${dateKey(entry.date)} → ${date}${
      room === undefined || room === '' ? '' : `, аудитория ${room}`
    }.`,
  );

  await writeAuditEvent({
    actorUserId: scope.user.id,
    action: 'schedule.move',
    entity: 'ScheduleEntry',
    entityId: updated.id,
    meta: { movedToDate: date, movedToRoom: room?.trim() ?? null },
  });

  return toLessonItem({ ...updated, groupId: entry.groupId });
}

/**
 * Отменяет пару: статус CANCELLED + причина в note. Причина обязательна —
 * студенты должны понимать, почему занятия не будет.
 */
export async function cancelStaffLesson(
  session: AuthSession,
  entryId: string,
  input: StaffLessonCancelInput,
): Promise<StaffLessonItem> {
  const scope = requireStaffScope(session);
  const parsed = staffLessonCancelSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные отмены.', firstIssues(parsed.error));
  }
  const { reason } = parsed.data;

  const entry = await loadLessonInScope(scope, entryId);
  if (!CHANGEABLE_STATUSES.includes(entry.status)) {
    throw new ValidationError(
      'CONFLICT',
      `Занятие уже ${SCHEDULE_STATUS_LABELS[entry.status].toLowerCase()}: изменение невозможно.`,
    );
  }

  const updated = await prisma().scheduleEntry.update({
    where: { id: entry.id },
    data: { status: 'CANCELLED', note: reason },
    include: LESSON_INCLUDE,
  });

  await notifyGroup(
    entry.groupId,
    'Пара отменена',
    `${entry.subject.name} (${entry.group.name}) ${dateKey(entry.date)} отменена. Причина: ${reason}`,
  );

  await writeAuditEvent({
    actorUserId: scope.user.id,
    action: 'schedule.cancel',
    entity: 'ScheduleEntry',
    entityId: updated.id,
    meta: { reason },
  });

  return toLessonItem({ ...updated, groupId: entry.groupId });
}

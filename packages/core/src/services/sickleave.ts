/**
 * Статус «болею»: студент отмечает период заболевания, деканат и
 * преподаватели получают уведомление (требование BRIEF v2).
 *
 * Правила:
 * - dateFrom <= dateTo;
 * - период не более 14 дней подряд;
 * - нельзя пересекаться с существующей активной записью студента
 *   (активная — та, что ещё не закончилась: dateTo >= сегодня).
 *
 * Даты хранятся как @db.Date (полночь UTC), сравнения — по UTC-дням.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStudent } from '../ownership';
import { ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import { startOfUtcDay, dateKey } from './schedule';
import type { AuthSession } from '../session';

/** Максимальная длина непрерывного периода болезни, дни. */
export const MAX_SICK_LEAVE_DAYS = 14;

/** Схема отметки о болезни (граница API: валидация до записи). */
export const sickLeaveFormSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата начала в формате YYYY-MM-DD'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата окончания в формате YYYY-MM-DD'),
  reason: z.string().max(500).optional(),
  attachmentPath: z.string().max(200).optional(),
});

export type CreateMySickLeaveInput = z.infer<typeof sickLeaveFormSchema>;

export interface MySickLeave {
  readonly id: string;
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly reason: string | null;
  /** Есть ли прикреплённая справка (путь в хранилище наружу не отдаём). */
  readonly hasAttachment: boolean;
  readonly createdAt: Date;
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('INVALID_INPUT', `Некорректная дата в поле «${field}».`);
  }
  return parsed;
}

/**
 * Создаёт запись «болею» для студента сессии. Валидирует период и
 * пересечения, затем уведомляет сотрудников деканата (STAFF/ADMIN) —
 * в прототипе это «синтетический реестр», по которому преподаватели
 * и деканат видят, кто болеет.
 */
export async function createMySickLeave(
  session: AuthSession,
  input: CreateMySickLeaveInput,
): Promise<MySickLeave> {
  const { studentId } = requireStudent(session);
  const parsed = sickLeaveFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные отметки о болезни.', firstIssues(parsed.error));
  }
  const { dateFrom: dateFromKey, dateTo: dateToKey, reason, attachmentPath } = parsed.data;

  const dateFrom = parseDate(dateFromKey, 'dateFrom');
  const dateTo = parseDate(dateToKey, 'dateTo');

  if (dateFrom.getTime() > dateTo.getTime()) {
    throw new ValidationError('INVALID_INPUT', 'Дата начала не может быть позже даты окончания.');
  }

  const days = Math.round((dateTo.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (days > MAX_SICK_LEAVE_DAYS) {
    throw new ValidationError(
      'INVALID_INPUT',
      `Нельзя отметить болезнь длиннее ${MAX_SICK_LEAVE_DAYS} дней подряд: оформите продление в деканате.`,
    );
  }

  // Активная запись: ещё не закончилась (dateTo >= сегодня).
  const today = startOfUtcDay(new Date());
  const overlapping = await prisma().sickLeave.findMany({
    where: {
      studentId,
      dateTo: { gte: today },
      dateFrom: { lte: dateTo },
    },
    select: { id: true, dateFrom: true, dateTo: true },
  });

  const conflict = overlapping.find(
    (leave) => leave.dateFrom.getTime() <= dateTo.getTime() && leave.dateTo.getTime() >= dateFrom.getTime(),
  );
  if (conflict !== undefined) {
    throw new ValidationError(
      'CONFLICT',
      `Период пересекается с активной отметкой о болезни (${dateKey(conflict.dateFrom)} — ${dateKey(conflict.dateTo)}).`,
    );
  }

  const student = await prisma().student.findUnique({
    where: { id: studentId },
    select: {
      userId: true,
      lastName: true,
      firstName: true,
      middleName: true,
      group: { select: { name: true } },
    },
  });
  if (student === null) {
    throw new ValidationError('NOT_FOUND', 'Профиль студента не найден. Обратитесь в деканат.');
  }

  const sickLeave = await prisma().sickLeave.create({
    data: {
      studentId,
      dateFrom,
      dateTo,
      reason: reason ?? null,
      attachmentPath: attachmentPath ?? null,
    },
  });

  const fullName =
    student.middleName === null
      ? `${student.lastName} ${student.firstName}`
      : `${student.lastName} ${student.firstName} ${student.middleName}`;

  // Уведомление деканату и преподавателям-сотрудникам о новом статусе.
  const staff = await prisma().user.findMany({
    where: { role: { in: ['STAFF', 'ADMIN'] } },
    select: { id: true },
  });
  if (staff.length > 0) {
    await prisma().notification.createMany({
      data: staff.map((user) => ({
        userId: user.id,
        type: 'SYSTEM' as const,
        title: 'Студент отметил болезнь',
        body: `${fullName} (${student.group.name}) — с ${dateFromKey} по ${dateToKey}.${
          reason !== undefined && reason !== '' ? ` Причина: ${reason}` : ''
        }`,
        link: '/staff/sick-leaves',
      })),
    });
  }

  await writeAuditEvent({
    actorUserId: student.userId,
    action: 'sick_leave.create',
    entity: 'SickLeave',
    entityId: sickLeave.id,
    meta: { dateFrom: dateFromKey, dateTo: dateToKey, days },
  });

  return {
    id: sickLeave.id,
    dateFrom: sickLeave.dateFrom,
    dateTo: sickLeave.dateTo,
    reason: sickLeave.reason,
    hasAttachment: sickLeave.attachmentPath !== null,
    createdAt: sickLeave.createdAt,
  };
}

/** История отметок о болезни студента (сначала новые). */
export async function getMySickLeaves(session: AuthSession): Promise<MySickLeave[]> {
  const { studentId } = requireStudent(session);
  const sickLeaves = await prisma().sickLeave.findMany({
    where: { studentId },
    orderBy: { dateFrom: 'desc' },
  });
  return sickLeaves.map((leave) => ({
    id: leave.id,
    dateFrom: leave.dateFrom,
    dateTo: leave.dateTo,
    reason: leave.reason,
    hasAttachment: leave.attachmentPath !== null,
    createdAt: leave.createdAt,
  }));
}

/**
 * Болеет ли студент сессии на указанную дату (по умолчанию — сегодня).
 * Используется преподавателем/деканатом для учёта посещаемости
 * (в прототипе — синтетический реестр).
 */
export async function isSickNow(session: AuthSession, date: Date = new Date()): Promise<boolean> {
  const { studentId } = requireStudent(session);
  const day = startOfUtcDay(date);
  const active = await prisma().sickLeave.findFirst({
    where: { studentId, dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { id: true },
  });
  return active !== null;
}

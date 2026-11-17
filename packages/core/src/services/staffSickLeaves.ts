/**
 * Статусы «болею» в кабинете сотрудника деканата: кто из студентов его
 * факультета болеет (BRIEF v2 §6, ARCHITECTURE §4).
 *
 * Владение: только студенты своего факультета (ADMIN — все).
 *
 * Фото справки о болезни здесь НЕ отдаётся намеренно: сотрудник видит
 * ФАКТ наличия справки (hasAttachment) — для прототипа этого достаточно,
 * а путь к файлу в приватном хранилище не покидает packages/core.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { startOfUtcDay } from './schedule';
import { requireStaffScope, facultyStudentFilter } from './staff-scope';
import { ValidationError } from '../errors';
import { firstIssues } from '../validation';
import type { AuthSession } from '../session';
import type { Prisma } from '@udgu/db';

/**
 * Схема фильтра списка болезней (сервисный вход: роут уже преобразовал
 * query-строку, поэтому onlyActive — булево, а не 'true'|'false').
 */
export const staffSickLeavesFilterSchema = z.object({
  /** Только те, кто болеет прямо сейчас (период покрывает сегодня). */
  onlyActive: z.boolean().default(false),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата начала в формате YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата окончания в формате YYYY-MM-DD').optional(),
});

export type StaffSickLeavesFilter = z.infer<typeof staffSickLeavesFilterSchema>;

/** Запись о болезни с ФИО, группой и периодом. */
export interface StaffSickLeaveItem {
  readonly id: string;
  readonly studentId: string;
  readonly fullName: string;
  readonly groupName: string;
  readonly faculty: string;
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly reason: string | null;
  /** Есть ли прикреплённая справка (путь в хранилище наружу не отдаём). */
  readonly hasAttachment: boolean;
}

export async function listStaffSickLeaves(
  session: AuthSession,
  filter: { onlyActive?: boolean; from?: string; to?: string } = {},
): Promise<StaffSickLeaveItem[]> {
  const scope = requireStaffScope(session);
  const parsed = staffSickLeavesFilterSchema.safeParse(filter);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный фильтр списка болезней.', firstIssues(parsed.error));
  }
  const { onlyActive, from, to } = parsed.data;

  const where: Prisma.SickLeaveWhereInput = {
    ...facultyStudentFilter(scope),
  };
  if (onlyActive) {
    const today = startOfUtcDay(new Date());
    where.dateFrom = { lte: today };
    where.dateTo = { gte: today };
  } else {
    if (from !== undefined) {
      where.dateTo = { gte: startOfUtcDay(new Date(`${from}T00:00:00.000Z`)) };
    }
    if (to !== undefined) {
      where.dateFrom = { lte: startOfUtcDay(new Date(`${to}T00:00:00.000Z`)) };
    }
  }

  const sickLeaves = await prisma().sickLeave.findMany({
    where,
    include: {
      student: {
        select: {
          id: true,
          lastName: true,
          firstName: true,
          middleName: true,
          faculty: true,
          group: { select: { name: true } },
        },
      },
    },
    orderBy: [{ dateFrom: 'desc' }, { dateTo: 'desc' }],
  });

  return sickLeaves.map((leave) => ({
    id: leave.id,
    studentId: leave.studentId,
    fullName:
      leave.student.middleName === null
        ? `${leave.student.lastName} ${leave.student.firstName}`
        : `${leave.student.lastName} ${leave.student.firstName} ${leave.student.middleName}`,
    groupName: leave.student.group.name,
    faculty: leave.student.faculty,
    dateFrom: leave.dateFrom,
    dateTo: leave.dateTo,
    reason: leave.reason,
    hasAttachment: leave.attachmentPath !== null,
  }));
}

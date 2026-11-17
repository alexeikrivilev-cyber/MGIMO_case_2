/**
 * Дашборд кабинета сотрудника деканата: счётчики очередей по ЕГО факультету
 * (ARCHITECTURE §4 — «сотрудник деканата — свой факультет; админ — всё»).
 *
 * Все счётчики считаются на сервере из БД по сессии: сотрудник не может
 * подменить факультет, а студент/преподаватель не доходят до сервиса
 * (requireStaffScope → STAFF_ONLY → 404).
 *
 * «Болеют сейчас» — запись SickLeave, покрывающая сегодняшний UTC-день
 * (dateFrom ≤ сегодня ≤ dateTo): утренняя сводка «кого не будет на парах».
 * «Изменения на сегодня» — пары групп факультета со статусом MOVED
 * (в исходном слоте), CANCELLED и пары, ПЕРЕНЕСЁННЫЕ на сегодня: сотрудник
 * видит и отмены, и то, что приехало в его день из других дат.
 */
import { prisma } from '../db';
import { startOfUtcDay } from './schedule';
import { requireStaffScope, facultyStudentFilter, type StaffScope } from './staff-scope';
import type { AuthSession } from '../session';

export interface StaffDashboard {
  /** Факультет сотрудника; null у ADMIN (все факультеты). */
  readonly faculty: string | null;
  /** Новые заявки (NEW) студентов факультета — очередь на обработку. */
  readonly newRequests: number;
  /** Заявки на верификацию студбилета в статусе PENDING — очередь на проверку. */
  readonly pendingVerifications: number;
  /** Сколько студентов болеет прямо сейчас (SickLeave покрывает сегодня). */
  readonly sickNow: number;
  /** Изменения расписания на сегодня: переносы и отмены (всего). */
  readonly todayScheduleChanges: number;
  /** Из них перенесены на сегодня из других дат. */
  readonly todayMovedIn: number;
}

/** Условие выбора пар по группам факультета сотрудника. */
function groupScopeFilter(scope: StaffScope): { group: { faculty: string } } | Record<string, never> {
  return scope.allFaculties ? {} : { group: { faculty: scope.faculty as string } };
}

export async function getStaffDashboard(session: AuthSession): Promise<StaffDashboard> {
  const scope = requireStaffScope(session);
  const today = startOfUtcDay(new Date());
  const [newRequests, pendingVerifications, sickLeaves, changes, movedIn] = await Promise.all([
    prisma().request.count({
      where: { status: 'NEW', ...facultyStudentFilter(scope) },
    }),
    prisma().studentVerification.count({
      where: { status: 'PENDING', ...facultyStudentFilter(scope) },
    }),
    // «Болеют сейчас»: считаем УНИКАЛЬНЫХ студентов — у студента может
    // быть несколько записей, но он болеет один раз.
    prisma().sickLeave.findMany({
      where: {
        dateFrom: { lte: today },
        dateTo: { gte: today },
        ...facultyStudentFilter(scope),
      },
      select: { studentId: true },
    }),
    prisma().scheduleEntry.count({
      where: {
        ...groupScopeFilter(scope),
        OR: [
          { date: today, status: { in: ['MOVED', 'CANCELLED'] } },
          { movedToDate: today, status: 'MOVED' },
        ],
      },
    }),
    prisma().scheduleEntry.count({
      where: {
        ...groupScopeFilter(scope),
        movedToDate: today,
        status: 'MOVED',
      },
    }),
  ]);

  return {
    faculty: scope.faculty,
    newRequests,
    pendingVerifications,
    sickNow: new Set(sickLeaves.map((leave) => leave.studentId)).size,
    todayScheduleChanges: changes,
    todayMovedIn: movedIn,
  };
}

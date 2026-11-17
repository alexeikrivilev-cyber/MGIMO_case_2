/**
 * GET /api/staff/schedule?from&to — расписание групп факультета
 * сотрудника за период (ARCHITECTURE §4). ADMIN — все факультеты.
 *
 * Период обязателен (иначе ответ раздувается всеми парами института).
 * Границы периода валидирует zod на границе, дальше — packages/core.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listStaffSchedule } from '@udgu/core';
import { staffScheduleQuerySchema } from '@/lib/validation';
import { parseQuery } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { from, to } = parseQuery(request, staffScheduleQuerySchema);
    const session = await requireSession(request);
    const lessons = await listStaffSchedule(session, { from, to });
    return NextResponse.json({ lessons });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

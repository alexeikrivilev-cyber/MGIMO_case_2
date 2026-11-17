/**
 * GET /api/staff/dashboard — сводка кабинета сотрудника деканата:
 * счётчики очередей ЕГО факультета (ARCHITECTURE §4). ADMIN видит все.
 *
 * Считает packages/core (getStaffDashboard) — маршрут не лезет в БД сам.
 * Преподаватель (STAFF без faculty) и студент получают 404: правило
 * STAFF_ONLY живёт в requireStaffScope, ответ не отличается от
 * «раздела не существует».
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getStaffDashboard } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const dashboard = await getStaffDashboard(session);
    return NextResponse.json({ dashboard });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

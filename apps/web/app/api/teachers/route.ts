/**
 * GET /api/teachers — список преподавателей (ФИО, кафедра, должность).
 *
 * Общедоступная информация кабинета (BRIEF v2): студенту нужно находить
 * преподавателя, чтобы посмотреть его расписание и часы приёма.
 * Через сервис packages/core — маршрут не обращается к БД напрямую.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listTeachers } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const teachers = await listTeachers(session);
    return NextResponse.json({ teachers });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

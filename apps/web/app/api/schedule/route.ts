/**
 * GET /api/schedule?view=today|week&offset=0 — расписание СВОЕЙ группы.
 *
 * view=today (по умолчанию): занятия за день + ближайшая пара
 * (nextLesson) + свободные окна между парами (freeGaps) — решение
 * Council «свободные окна между парами».
 * view=week: сетка недели (7 дней, включая пустые), offset — смещение
 * недели (-52..52).
 *
 * Группа берётся из сессии (packages/core): подменить её query нельзя.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  dateKey,
  getFreeGaps,
  getMyNextLesson,
  getMyScheduleToday,
  getMyScheduleWeek,
} from '@udgu/core';
import { scheduleQuerySchema } from '@/lib/validation';
import { parseQuery } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { view, offset } = parseQuery(request, scheduleQuerySchema);
    const session = await requireSession(request);

    if (view === 'week') {
      const week = await getMyScheduleWeek(session, offset);
      return NextResponse.json({ view: 'week', offset, week });
    }

    const [lessons, nextLesson, freeGaps] = await Promise.all([
      getMyScheduleToday(session),
      getMyNextLesson(session),
      getFreeGaps(session),
    ]);
    return NextResponse.json({
      view: 'today',
      date: dateKey(new Date()),
      lessons,
      nextLesson,
      freeGaps,
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

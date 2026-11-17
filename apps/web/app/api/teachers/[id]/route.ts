/**
 * GET /api/teachers/[id] — карточка преподавателя: расписание на две
 * недели вперёд + часы приёма/консультации (BRIEF v2).
 *
 * Несуществующий идентификатор → 404 (packages/core, NOT_FOUND).
 * Идентификатор преподавателя не является идентификатором владения
 * данными: чужого здесь нет — только публичный справочник кабинета.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { addUtcDays, getTeacherCard } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

/** Горизонт расписания преподавателя, дни. */
const TEACHER_HORIZON_DAYS = 14;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const teacherId = pathParam(id, 'преподавателя');
    const session = await requireSession(request);

    const from = new Date();
    const to = addUtcDays(from, TEACHER_HORIZON_DAYS - 1);
    const teacher = await getTeacherCard(session, teacherId, from, to);
    return NextResponse.json({ teacher, from, to });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

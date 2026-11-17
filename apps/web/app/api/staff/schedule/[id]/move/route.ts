/**
 * POST /api/staff/schedule/[id]/move — перенос пары на новую дату
 * (и, опционально, в новую аудиторию).
 *
 * Вся логика — в packages/core (moveStaffLesson): статус MOVED +
 * movedToDate/movedToRoom, уведомление студентам группы, аудит. Пара
 * чужого факультета → 404 (обобщённый ответ, анти-IDOR).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { moveStaffLesson } from '@udgu/core';
import { staffLessonMoveSchema } from '@/lib/validation';
import { parseJsonBody, pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const entryId = pathParam(id, 'занятия');
    const input = await parseJsonBody(request, staffLessonMoveSchema);
    const session = await requireSession(request);
    const lesson = await moveStaffLesson(session, entryId, input);
    return NextResponse.json({ lesson });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

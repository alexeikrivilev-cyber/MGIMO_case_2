/**
 * POST /api/staff/schedule/[id]/cancel — отмена пары с обязательной
 * причиной (packages/core: cancelStaffLesson). Статус CANCELLED +
 * причина в note, уведомление студентам группы, аудит. Пара чужого
 * факультета → 404 (обобщённый ответ, анти-IDOR).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cancelStaffLesson } from '@udgu/core';
import { staffLessonCancelSchema } from '@/lib/validation';
import { parseJsonBody, pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const entryId = pathParam(id, 'занятия');
    const input = await parseJsonBody(request, staffLessonCancelSchema);
    const session = await requireSession(request);
    const lesson = await cancelStaffLesson(session, entryId, input);
    return NextResponse.json({ lesson });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

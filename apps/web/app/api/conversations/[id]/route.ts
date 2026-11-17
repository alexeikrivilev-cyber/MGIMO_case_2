/**
 * GET /api/conversations/[id] — диалог с сообщениями.
 *
 * Владение: диалог принадлежит сессии, если пара (studentId, teacherId)
 * совпадает с владельцем сессии. Чужой идентификатор → 404 (ответ не
 * отличается от «не существует» — анти-IDOR, проверяется тестом:
 * student2 не открывает диалог student1).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConversation } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const conversationId = pathParam(id, 'диалога');
    const session = await requireSession(request);
    const conversation = await getConversation(session, conversationId);
    return NextResponse.json({ conversation });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

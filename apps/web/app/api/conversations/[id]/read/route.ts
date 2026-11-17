/**
 * POST /api/conversations/[id]/read — отметить диалог прочитанным.
 *
 * Отмечаются сообщения ДРУГОГО автора без readAt (packages/core,
 * markConversationRead): свой счетчик непрочитанных не обнуляется.
 * Чужой диалог → 404 (обобщённый ответ).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { markConversationRead } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const conversationId = pathParam(id, 'диалога');
    const session = await requireSession(request);
    const updated = await markConversationRead(session, conversationId);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

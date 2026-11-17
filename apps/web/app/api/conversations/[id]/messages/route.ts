/**
 * POST /api/conversations/[id]/messages — сообщение в диалоге.
 *
 * Вся логика — в packages/core (sendMessage): гейт верификации для
 * студента, владение диалогом по сессии (чужой → 404), уведомление
 * получателю (type MESSAGE, ссылка /messages), аудит. Обрезанные
 * пробелы и пустой текст отсекает схема (400).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sendMessage } from '@udgu/core';
import { messageBodySchema } from '@/lib/validation';
import { parseJsonBody, pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const conversationId = pathParam(id, 'диалога');
    const input = await parseJsonBody(request, messageBodySchema);
    const session = await requireSession(request);
    const message = await sendMessage(session, conversationId, input);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

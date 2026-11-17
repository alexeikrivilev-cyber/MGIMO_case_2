/**
 * /api/conversations — переписка кабинета (BRIEF v2 §4).
 *
 * GET  — диалоги владельца сессии: студент видит диалоги с преподавателями,
 *        преподаватель — диалоги, где ему пишут студенты (в каждом видно
 *        ФИО и группу автора). Неверифицированный студент → 403
 *        VERIFICATION_REQUIRED: переписка закрыта до сверки студбилета.
 * POST — студент начинает (или открывает существующий) диалог с
 *        преподавателем: { teacherId }. Преподаватель начинать диалог
 *        не может — инициатива принадлежит студенту.
 *
 * Вся логика — в packages/core (services/messaging.ts): владение диалогом
 * проверяется по паре (studentId, teacherId) сессии, чужой
 * conversationId → 404 (обобщённый ответ, анти-IDOR).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listMyConversations, startConversationWithTeacher } from '@udgu/core';
import { conversationStartSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const conversations = await listMyConversations(session);
    return NextResponse.json({ conversations });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = await parseJsonBody(request, conversationStartSchema);
    const session = await requireSession(request);
    const conversation = await startConversationWithTeacher(session, input);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

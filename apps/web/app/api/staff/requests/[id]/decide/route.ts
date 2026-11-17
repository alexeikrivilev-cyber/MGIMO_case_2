/**
 * POST /api/staff/requests/[id]/decide — решение сотрудника по заявке:
 * статус (IN_PROGRESS|READY|REJECTED) + комментарий.
 *
 * Вся логика — в packages/core (decideStaffRequest): REJECTED требует
 * непустой комментарий, терминальные статусы (READY/REJECTED) не
 * меняются, студент получает уведомление, решение пишется в аудит.
 * Чужая заявка → 404 (обобщённый ответ, анти-IDOR).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decideStaffRequest } from '@udgu/core';
import { staffRequestDecisionSchema } from '@/lib/validation';
import { parseJsonBody, pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const requestId = pathParam(id, 'заявки');
    const input = await parseJsonBody(request, staffRequestDecisionSchema);
    const session = await requireSession(request);
    const request_ = await decideStaffRequest(session, requestId, input);
    return NextResponse.json({ request: request_ });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

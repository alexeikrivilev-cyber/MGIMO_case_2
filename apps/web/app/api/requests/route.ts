/**
 * /api/requests — заявки и справки студента.
 *
 * GET  — история своих заявок (сначала новые).
 * POST — создать заявку (тип REFERENCE|APPLICATION + форма). Статус
 *        всегда NEW; уведомление и аудит создаёт packages/core.
 *
 * Владение: все операции идут через сервисы packages/core с сессией —
 * студент резолвится из cookie, studentId из тела/query не принимается.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createMyRequest, getMyRequests } from '@udgu/core';
import { requestCreateSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';
import { enforceSessionRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const requests = await getMyRequests(session);
    return NextResponse.json({ requests });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    // Rate-limit кабинета: 30 заявок в минуту на сессию.
    const limited = enforceSessionRateLimit(session, 'requests');
    if (limited !== null) {
      return limited;
    }
    const input = await parseJsonBody(request, requestCreateSchema);
    const request_ = await createMyRequest(session, input);
    return NextResponse.json({ request: request_ }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

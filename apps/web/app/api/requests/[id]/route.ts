/**
 * GET /api/requests/[id] — своя заявка по идентификатору.
 *
 * Анти-IDOR (ARCHITECTURE §3, ACCEPTANCE): чужая или несуществующая
 * заявка даёт ОДИН ответ 404 — packages/core бросает OwnershipError
 * NOT_OWNER, который отображается в обобщённое «не найдено». Различить
 * «не существует» и «не твоя» по ответу невозможно.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMyRequest } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const requestId = pathParam(id, 'заявки');
    const session = await requireSession(request);
    const request_ = await getMyRequest(session, requestId);
    return NextResponse.json({ request: request_ });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

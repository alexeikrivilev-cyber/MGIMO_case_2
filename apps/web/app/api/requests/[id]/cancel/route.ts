/**
 * POST /api/requests/[id]/cancel — отмена СВОЕЙ заявки.
 *
 * Правила (packages/core): отмена возможна только в статусе NEW —
 * дальше заявку взял в работу сотрудник деканата; чужая заявка → 404
 * (обобщённый ответ, анти-IDOR).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cancelMyRequest } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const requestId = pathParam(id, 'заявки');
    const session = await requireSession(request);
    const request_ = await cancelMyRequest(session, requestId);
    return NextResponse.json({ request: request_ });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

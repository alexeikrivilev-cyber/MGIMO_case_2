/**
 * POST /api/notifications/[id]/read — отметить СВОЁ уведомление
 * прочитанным. Идемпотентно; чужое или несуществующее → 404
 * (обобщённый ответ, packages/core OwnershipError NOT_OWNER).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { markNotificationRead } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const notificationId = pathParam(id, 'уведомления');
    const session = await requireSession(request);
    await markNotificationRead(session, notificationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

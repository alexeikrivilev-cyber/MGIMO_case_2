/**
 * POST /api/auth/logout — выход: отзыв сессии, очистка cookie, аудит.
 *
 * Идемпотентен: если сессия уже невалидна/истекла, cookie всё равно
 * очищаются (браузер не должен носить мусор), аудит не пишется — некому.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { writeAuditEvent } from '@udgu/core';
import { clientIp } from '@/lib/http';
import {
  clearSessionCookies,
  coreErrorResponse,
  getSessionFromRequest,
  revokeSessionFromRequest,
} from '@/lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (session !== null) {
      await revokeSessionFromRequest(request);
      await writeAuditEvent({
        actorUserId: session.user.id,
        action: 'LOGOUT',
        entity: 'Session',
        entityId: session.session.id,
        meta: { ip: clientIp(request) },
      });
    }
    const response = NextResponse.json({ ok: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return coreErrorResponse(error);
  }
}

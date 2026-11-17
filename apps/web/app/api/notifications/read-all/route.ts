/**
 * POST /api/notifications/read-all — отметить прочитанными все
 * уведомления пользователя сессии. Возвращает число обновлённых.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { markAllRead } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const result = await markAllRead(session);
    return NextResponse.json({ ok: true, updated: result.updated });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

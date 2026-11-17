/**
 * /api/notifications — уведомления пользователя сессии.
 *
 * GET — лента (последние 100) + счётчик непрочитанных.
 * Уведомления адресуются пользователем (userId из сессии): чужие
 * недоступны даже по идентификатору — markNotificationRead бросает
 * OwnershipError → 404 (обобщённый ответ).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMyNotifications, getMyUnreadCount } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const [notifications, unreadCount] = await Promise.all([
      getMyNotifications(session),
      getMyUnreadCount(session),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

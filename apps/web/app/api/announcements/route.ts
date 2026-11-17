/**
 * GET /api/announcements — объявления деканата, видимые студенту
 * сессии: общие (ALL) + его институт (FACULTY) + его группа (GROUP),
 * закреплённые сверху (решение Council: важное не тонет в ленте).
 *
 * Аудитория фильтруется по профилю из сессии — studentId/groupId извне
 * не принимаются (packages/core).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAnnouncementsFor } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const announcements = await getAnnouncementsFor(session);
    return NextResponse.json({ announcements });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

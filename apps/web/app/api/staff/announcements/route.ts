/**
 * /api/staff/announcements — объявления деканата.
 *
 * GET  — объявления, видимые сотруднику: весь университет (ALL), его
 *        институт и группы его института (packages/core).
 * POST — публикация. Аудитория: FACULTY → институт СОТРУДНИКА (из
 *        сессии, не из тела!), GROUP → группа того же факультета,
 *        ALL → только ADMIN (решение зафиксировано в staffAnnouncements.ts).
 *        Каждая публикация рассылает уведомления студентам аудитории
 *        и пишется в аудит.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createStaffAnnouncement, listStaffAnnouncements } from '@udgu/core';
import { staffAnnouncementSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const announcements = await listStaffAnnouncements(session);
    return NextResponse.json({ announcements });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = await parseJsonBody(request, staffAnnouncementSchema);
    const session = await requireSession(request);
    const announcement = await createStaffAnnouncement(session, input);
    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

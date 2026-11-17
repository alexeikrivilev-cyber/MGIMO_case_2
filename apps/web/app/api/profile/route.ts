/**
 * GET /api/profile — свой профиль студента (ФИО, институт, направление,
 * курс, группа, статус верификации). Доступен всегда, в том числе до
 * верификации (BRIEF v2). Владение — из сессии, идентификаторы не
 * принимаются.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMyProfile } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const profile = await getMyProfile(session);
    return NextResponse.json({ profile });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

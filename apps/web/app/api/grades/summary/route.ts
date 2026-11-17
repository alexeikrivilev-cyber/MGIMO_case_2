/**
 * GET /api/grades/summary — сводка «как у меня дела» (требование ядра):
 * средний балл, долги, тренд между семестрами, что подтянуть.
 *
 * Гейт верификации — как у /api/grades (403 VERIFICATION_REQUIRED).
 * Расчёт «левериджа» до целевого балла делает UI на основе этих данных
 * (calculateLeverage — чистая функция packages/core).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMyAcademicSummary } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const summary = await getMyAcademicSummary(session);
    return NextResponse.json({ summary });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

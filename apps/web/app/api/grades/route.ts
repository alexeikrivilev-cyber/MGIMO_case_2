/**
 * GET /api/grades?semester= — свои оценки и зачёты по дисциплинам,
 * сгруппированные по семестрам (сначала новые).
 *
 * ГЕЙТ ВЕРИФИКАЦИИ (BRIEF v2, ACCEPTANCE): до верификации студбилета
 * успеваемость закрыта. Проверка — на сервере в packages/core
 * (requireVerifiedStudent), ответ 403 с кодом VERIFICATION_REQUIRED.
 *
 * semester — необязательный фильтр (1..20). Владение — из сессии.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMyGrades } from '@udgu/core';
import { gradesQuerySchema } from '@/lib/validation';
import { parseQuery } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { semester } = parseQuery(request, gradesQuerySchema);
    const session = await requireSession(request);
    const grades = await getMyGrades(session, semester);
    return NextResponse.json({ semester: semester ?? null, ...grades });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

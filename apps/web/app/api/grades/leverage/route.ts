/**
 * POST /api/grades/leverage — «леверидж» до целевого среднего балла
 * (решение Council, docs/PRD.md §8): сколько баллов нужно на оставшихся
 * (ещё неоценённых) работах, чтобы выйти на цель.
 *
 * Расчёт делает packages/core (calculateLeverage) — на клиенте формула
 * не дублируется. Список работ берётся из БД по сессии: оценённые
 * (EXAM/COURSEWORK со значением) и предстоящие (value === null).
 * Зачёты (CREDIT) в средний балл не входят и в расчёт не передаются.
 *
 * Гейт верификации — как у /api/grades: успеваемость доступна только
 * после верификации студбилета (403 VERIFICATION_REQUIRED).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  calculateLeverage,
  getMyGrades,
  type LeverageResult,
} from '@udgu/core';
import { leverageBodySchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const { targetGpa } = await parseJsonBody(request, leverageBodySchema);

    // requireVerifiedStudent внутри getMyGrades: до верификации — 403.
    const grades = await getMyGrades(session);

    // Работы для расчёта: только численные оценки (EXAM/COURSEWORK).
    // value === null — работа ещё не оценена (семестр в процессе).
    const works = grades.semesters
      .flatMap((semester) => semester.entries)
      .filter((entry) => entry.type !== 'CREDIT')
      .map((entry) => ({ value: entry.value }));

    const result: LeverageResult = calculateLeverage(works, targetGpa);
    return NextResponse.json({ result });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

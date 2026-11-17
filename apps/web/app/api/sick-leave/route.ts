/**
 * /api/sick-leave — статус «болею» (BRIEF v2).
 *
 * GET  — свои отметки о болезни (сначала новые) + болею ли прямо сейчас
 *        (sickNow) — этим же флагом пользуются преподаватели и деканат
 *        для учёта посещаемости (в прототипе — синтетический реестр).
 * POST — отметить болезнь: период YYYY-MM-DD..YYYY-MM-DD, необязательная
 *        причина. Правила (≤14 дней подряд, без пересечений с активной
 *        отметкой) и уведомление сотрудникам деканата — в packages/core.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createMySickLeave, getMySickLeaves, isSickNow } from '@udgu/core';
import { sickLeaveCreateSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const [items, sickNow] = await Promise.all([getMySickLeaves(session), isSickNow(session)]);
    return NextResponse.json({ items, sickNow });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const input = await parseJsonBody(request, sickLeaveCreateSchema);
    const sickLeave = await createMySickLeave(session, input);
    return NextResponse.json({ sickLeave }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

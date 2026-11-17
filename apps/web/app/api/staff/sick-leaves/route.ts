/**
 * GET /api/staff/sick-leaves — кто из студентов факультета сотрудника
 * болеет (BRIEF v2 §6). ?onlyActive=true — только те, чей период
 * покрывает сегодня; ?from&to — фильтр по пересечению с периодом.
 *
 * Фото справок НЕ отдаются: только факт наличия (hasAttachment) —
 * путь к файлу в приватном хранилище остаётся в packages/core.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listStaffSickLeaves } from '@udgu/core';
import { staffSickLeavesQuerySchema } from '@/lib/validation';
import { parseQuery } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { onlyActive, from, to } = parseQuery(request, staffSickLeavesQuerySchema);
    const session = await requireSession(request);
    const sickLeaves = await listStaffSickLeaves(session, {
      onlyActive: onlyActive === 'true',
      from,
      to,
    });
    return NextResponse.json({ sickLeaves });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

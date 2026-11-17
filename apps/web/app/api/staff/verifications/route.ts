/**
 * GET /api/staff/verifications — очередь верификаций студбилетов
 * факультета сотрудника (BRIEF v2 §6). ?status=PENDING|VERIFIED|REJECTED.
 * Сначала PENDING. Распознанные поля и matchScore — для решения
 * сотрудника; путь к фото клиенту не отдаётся.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listStaffVerifications } from '@udgu/core';
import { staffVerificationsQuerySchema } from '@/lib/validation';
import { parseQuery } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { status } = parseQuery(request, staffVerificationsQuerySchema);
    const session = await requireSession(request);
    const verifications = await listStaffVerifications(session, { status });
    return NextResponse.json({ verifications });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

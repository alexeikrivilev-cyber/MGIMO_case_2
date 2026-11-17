/**
 * GET /api/staff/requests — очередь заявок и справок факультета
 * сотрудника (ARCHITECTURE §4). ?status=NEW|IN_PROGRESS|READY|REJECTED
 * фильтрует по статусу.
 *
 * Владение: список строится packages/core по факультету из сессии —
 * заявки чужих факультетов не отдаются даже при подмене query.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listStaffRequests } from '@udgu/core';
import { staffRequestsQuerySchema } from '@/lib/validation';
import { parseQuery } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { status } = parseQuery(request, staffRequestsQuerySchema);
    const session = await requireSession(request);
    const requests = await listStaffRequests(session, { status });
    return NextResponse.json({ requests });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

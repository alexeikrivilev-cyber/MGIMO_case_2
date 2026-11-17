/**
 * POST /api/staff/verifications/[id]/decide — решение сотрудника по
 * верификации студбилета.
 *
 * Бизнес-логика НЕ дублируется: decideStaffVerification (packages/core)
 * проверяет faculty-scope и делегирует СУЩЕСТВУЮЩЕМУ reviewVerification —
 * REJECTED требует комментарий, студент получает уведомление, решение
 * пишется в аудит. Заявка чужого факультета → 404.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decideStaffVerification } from '@udgu/core';
import { verificationReviewSchema } from '@/lib/validation';
import { parseJsonBody, pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const verificationId = pathParam(id, 'заявки на верификацию');
    const input = await parseJsonBody(request, verificationReviewSchema);
    const session = await requireSession(request);
    const verification = await decideStaffVerification(session, verificationId, input);
    return NextResponse.json({ verification });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

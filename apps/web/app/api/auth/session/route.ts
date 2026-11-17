/**
 * GET /api/auth/session — текущий пользователь и гейт верификации.
 *
 * Отдаёт 401, если сессии нет (middleware закрывает маршрут ещё до
 * обработчика, но маршрут перепроверяет сессию сам — решения об
 * авторизации не зависят от того, что прошли гейт).
 *
 * verificationGate (packages/core): что открыто студенту СЕЙЧАС —
 * оценки и переписка закрыты до верификации студбилета (BRIEF v2).
 * Гейт — студенческая концепция: у сотрудников и админа его нет
 * (requireStudent бросил бы NOT_A_STUDENT), поэтому для них null.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getVerificationGate } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const verificationGate =
      session.user.role === 'STUDENT' ? await getVerificationGate(session) : null;
    return NextResponse.json({
      user: {
        id: session.user.id,
        login: session.user.login,
        role: session.user.role,
        studentId: session.user.studentId,
        teacherId: session.user.teacherId,
      },
      session: {
        id: session.session.id,
        createdAt: session.session.createdAt,
        expiresAt: session.session.expiresAt,
      },
      verificationGate,
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

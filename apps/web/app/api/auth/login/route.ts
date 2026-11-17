/**
 * POST /api/auth/login — вход по логину/паролю университетской учётной записи.
 *
 * Меры безопасности (ARCHITECTURE §4, ACCEPTANCE):
 * - argon2id-провка пароля через packages/core (verifyPassword);
 * - rate-limit 5 неуспешных попыток / 15 мин на пару (логин, IP) → 429
 *   с заголовком Retry-After;
 * - ОДНА обобщённая ошибка «Неверный логин или пароль» и для несуществу-
 *   ющего логина, и для неверного пароля — иначе API становится оракулом
 *   перебора учётных записей;
 * - равномерное время ответа: при неизвестном логине пароль всё равно
 *   проверяется против «фиктивного» хеша, чтобы отсутствие argon2-работы
 *   не выдавало существование пользователя по таймингу;
 * - сессия создаётся в packages/core (в БД только sha256 токена), токен
 *   уходит в httpOnly-cookie; вместе с ним выдаётся CSRF-cookie;
 * - аудит: LOGIN_SUCCESS / LOGIN_FAILED (для существующего пользователя).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import {
  checkLoginRateLimit,
  createSession,
  hashPassword,
  recordLoginAttempt,
  verifyPassword,
  writeAuditEvent,
} from '@udgu/core';
import { getPrisma } from '@udgu/db';
import { loginSchema } from '@/lib/validation';
import { clientIp, parseJsonBody, userAgent } from '@/lib/http';
import { coreErrorResponse, issueCsrfCookie, setSessionCookie } from '@/lib/session';

/** Кеш фиктивного хеша для выравнивания тайминга (см. комментарий файла). */
let dummyPasswordHash: string | null = null;

async function burnArgon2Time(password: string): Promise<void> {
  dummyPasswordHash ??= await hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(dummyPasswordHash, password);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { login, password } = await parseJsonBody(request, loginSchema);
    const ip = clientIp(request);
    const userAgentHeader = userAgent(request);

    // 1. Rate-limit до любой работы с БД и argon2.
    const limit = checkLoginRateLimit(login, ip);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Слишком много неуспешных попыток входа. Попробуйте снова позже.',
          },
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    // 2. Пользователь (регистр логина не важен — УЗ вуза в нижнем регистре).
    const user = await getPrisma().user.findFirst({
      where: { login: { equals: login, mode: 'insensitive' } },
      select: { id: true, role: true, passwordHash: true },
    });

    const passwordMatches =
      user === null ? await burnArgon2Time(password) : await verifyPassword(user.passwordHash, password);

    if (user === null || !passwordMatches) {
      recordLoginAttempt(login, ip, false);
      if (user !== null) {
        await writeAuditEvent({
          actorUserId: user.id,
          action: 'LOGIN_FAILED',
          entity: 'User',
          entityId: user.id,
          meta: { ip },
        });
      }
      // Обобщённая ошибка: не различаем «нет такого логина» и «неверный пароль».
      return NextResponse.json(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль.' } },
        { status: 401 },
      );
    }

    // 3. Успех: сбрасываем счётчик попыток, создаём сессию, аудит.
    recordLoginAttempt(login, ip, true);
    const { token, session } = await createSession(user.id, { ip, userAgent: userAgentHeader });
    await writeAuditEvent({
      actorUserId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'Session',
      entityId: session.id,
      meta: { ip },
    });

    const redirectTo = user.role === 'STUDENT' ? '/dashboard' : '/staff';
    const response = NextResponse.json({ ok: true, redirectTo });
    setSessionCookie(response, token);
    issueCsrfCookie(response);
    return response;
  } catch (error) {
    return coreErrorResponse(error);
  }
}

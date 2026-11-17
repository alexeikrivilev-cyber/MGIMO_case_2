/**
 * GET /api/auth/csrf — выдача CSRF-токена (паттерн «двойная отправка»).
 *
 * Публичная точка входа: токен нужен ДО входа — иначе клиент не сможет
 * отправить защищённый POST (включая сам вход на других экранах).
 * Токен ставится в cookie без HttpOnly (её должен прочитать JS) и
 * возвращается в теле — клиент дублирует значение в заголовке
 * X-CSRF-Token, middleware сверяет их (timingSafeEqual в packages/core).
 *
 * Токен не является секретом авторизации: он доказывает «один браузер».
 */
import { NextResponse } from 'next/server';
import { generateCsrfToken } from '@udgu/core';
import { setCsrfCookie } from '@/lib/session';

export async function GET(): Promise<NextResponse> {
  const csrfToken = generateCsrfToken();
  const response = NextResponse.json({ csrfToken });
  setCsrfCookie(response, csrfToken);
  return response;
}

/**
 * POST /api/bot/link-code — код привязки канала к учётной записи (BRIEF v3).
 *
 * Студент берёт код в кабинете (раздел «Каналы») и отправляет его боту
 * командой /link — так аккаунт мессенджера связывается с той же учётной
 * записью, что и сайт (OAuthAccount, packages/core/src/bot/identity.ts).
 *
 * Границы:
 * - requireSession: код выдаётся только владельцу сессии, userId из тела
 *   не принимается вовсе;
 * - канал из тела обязателен: код, выданный для Telegram, не привяжет VK
 *   (проверяет ядро, здесь лишь передаём провайдера канала);
 * - CSRF — middleware (все изменяющие запросы к /api/*);
 * - в ответе только код и срок годности: токены ботов и внутренние
 *   идентификаторы не отдаются.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { botChannelProvider, createBotLinkCode } from '@udgu/core';
import { botLinkCodeSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const { channel } = await parseJsonBody(request, botLinkCodeSchema);

    const created = await createBotLinkCode(session, botChannelProvider(channel));

    return NextResponse.json({
      channel,
      code: created.code,
      expiresAt: created.expiresAt.toISOString(),
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

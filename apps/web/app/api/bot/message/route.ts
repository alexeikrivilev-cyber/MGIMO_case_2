/**
 * POST /api/bot/message — команда боту из симулятора каналов (BRIEF v3).
 *
 * Симулятор на странице /channels действует от СЕССИИ пользователя, но
 * через ТОТ ЖЕ handleBotCommand, что и живой бот: команда вызывает те же
 * сервисы кабинета и получает те же проверки владения и гейт верификации.
 * Отличие ровно одно — откуда взялся channelUserId: у живого бота его
 * присылает провайдер, у симулятора он детерминированно выводится из
 * сессии (demo-<канал>-<userId>).
 *
 * ГРАНИЦА БЕЗОПАСНОСТИ (самое важное в этом роуте): channelUserId из тела
 * запроса НЕ ПРИНИМАЕТСЯ ни при каких условиях. Принять его значило бы
 * позволить клиенту назваться чужим аккаунтом мессенджера и читать чужой
 * кабинет: /schedule отвечал бы расписанием другого студента. Поэтому
 * схема тела (botMessageSchema) не содержит такого поля, а идентификатор
 * вычисляется здесь из session.user.id.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleBotCommand } from '@udgu/core';
import { botMessageSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';
import { demoChannelUserId } from '@/lib/bot/demo-channel';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const { channel, text } = await parseJsonBody(request, botMessageSchema);

    // Идентификатор аккаунта канала — ТОЛЬКО из сессии (см. комментарий файла).
    const channelUserId = demoChannelUserId(channel, session.user.id);
    const replies = await handleBotCommand({ channel, channelUserId, text });

    return NextResponse.json({
      channel,
      replies: replies.map((reply) => reply.text),
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

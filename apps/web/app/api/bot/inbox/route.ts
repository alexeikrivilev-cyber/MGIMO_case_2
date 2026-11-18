/**
 * GET /api/bot/inbox — уведомления, доставленные в каналы пользователя
 * (BRIEF v3, outbox).
 *
 * Кабинет показывает те же записи, которые ушли (или ждут отправки) в
 * Telegram / VK / MAX: заголовок, текст и статус — PENDING (ждёт
 * адаптера), SENT (доставлено живым адаптером), DEMO (канал в демо-режиме:
 * токен бота не задан), FAILED (сбой, текст причины в error).
 *
 * Статус честный: в демо-режиме запись закрывается как DEMO, а не
 * притворяется доставленной. Владение — по сессии (listChannelInbox),
 * userId из query не принимается.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listChannelInbox, type ChannelDeliveryItem } from '@udgu/core';
import { coreErrorResponse, requireSession } from '@/lib/session';
// Форма ответа для браузера: даты — ISO-строки (единый контракт с клиентом).
import type { ChannelInboxItem } from '@/lib/api-client';

/** Запись outbox → форма для браузера (те же поля, даты строками). */
function toPayload(item: ChannelDeliveryItem): ChannelInboxItem {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    sentAt: item.sentAt === null ? null : item.sentAt.toISOString(),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const deliveries = await listChannelInbox(session);
    return NextResponse.json({ deliveries: deliveries.map(toPayload) });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

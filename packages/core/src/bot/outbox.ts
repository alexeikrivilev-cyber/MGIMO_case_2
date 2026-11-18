/**
 * Outbox доставки уведомлений в каналы доступа (BRIEF v3).
 *
 * ЗАЧЕМ: уведомление студента должно прийти и на сайт, и в его канал
 * (Telegram / VK / MAX), но канал не является источником истины. Поэтому
 * кабинет пишет одну запись на каждый привязанный канал пользователя
 * (PENDING), а адаптеры каналов забирают их отсюда и отправляют боту.
 *
 * Почему outbox, а не прямой вызов адаптера из сервиса кабинета:
 * - сервисы ядра не знают ни про мессенджеры, ни про сеть — их можно
 *   вызывать из тестов и из CLI без токенов ботов;
 * - демо-режим честен: если адаптера нет (ключей бота в env нет),
 *   записи закрываются статусом DEMO, а не теряются и не притворяются
 *   доставленными;
 * - сбой доставки не теряет уведомление: FAILED + текст ошибки, запись
 *   можно переотправить тем же диспетчером.
 *
 * Доставка инъекцией: dispatchPendingDeliveries принимает функцию
 * доставки, поэтому ядро не зависит ни от SDK провайдеров, ни от env.
 * Доставщик получает провайдера, текст и ПОЛУЧАТЕЛЯ (идентификатор
 * аккаунта канала из OAuthAccount) — без получателя адаптер не знает,
 * в какой чат писать, и «живой» канал оказался бы заглушкой.
 */
import { prisma } from '../db';
import { requireUser } from '../ownership';
import type { AuthSession } from '../session';
import type { ChannelDeliveryStatus, OAuthProvider } from '@udgu/db';
import { botChannelForProvider, type BotChannel } from './protocol';

/** Сколько записей inbox показывает кабинет. */
export const CHANNEL_INBOX_LIMIT = 50;

/** Сколько PENDING-записей забирает один проход диспетчера. */
export const DISPATCH_BATCH_SIZE = 100;

/** Максимальная длина текста ошибки доставки в БД. */
export const MAX_DELIVERY_ERROR_LENGTH = 500;

/** Что кабинет передаёт в outbox: заголовок, текст и (опционально) ссылка. */
export interface ChannelDeliveryInput {
  readonly title: string;
  readonly body: string;
  /**
   * Ссылка кабинета (например, /requests). Модель outbox не хранит её
   * отдельно: в канале ссылка — часть текста сообщения, иначе адаптеру
   * пришлось бы придумывать для неё формат. Кабинет показывает ту же
   * запись, которая ушла в канал.
   */
  readonly link?: string | null;
}

/** Запись outbox в представлении кабинета. */
export interface ChannelDeliveryItem {
  readonly id: string;
  readonly channel: BotChannel | null;
  readonly provider: OAuthProvider;
  readonly title: string;
  readonly body: string;
  readonly status: ChannelDeliveryStatus;
  readonly error: string | null;
  readonly createdAt: Date;
  /** Момент выхода из outbox: SENT — доставлено адаптером, DEMO — демо-режим. */
  readonly sentAt: Date | null;
}

/**
 * Получатель записи outbox: учётная запись и идентификатор её аккаунта
 * в мессенджере (providerAccountId привязанной OAuthAccount).
 *
 * ЗАЧЕМ доставщику получатель: без него адаптер канала знает только
 * провайдера («TELEGRAM»), но не чат — отправить сообщение некуда, и
 * «живой» адаптер оказался бы заглушкой. providerAccountId берётся из
 * ТОЙ ЖЕ OAuthAccount, по которой запись создана (enqueue пишет по
 * одной на привязанный канал), поэтому получатель не может оказаться
 * чужим: подменить его значило бы подменить ответ провайдера.
 *
 * null — привязка канала исчезла между enqueue и доставкой (аккаунт
 * отвязан): запись не уходит в неизвестный чат, решение принимает
 * доставщик (адаптер канала бросает ошибку → FAILED с текстом).
 */
export interface ChannelDeliveryRecipient {
  readonly userId: string;
  /** Идентификатор аккаунта в мессенджере = providerAccountId OAuthAccount. */
  readonly channelUserId: string;
}

/** Функция доставки в канал: её пишет адаптер провайдера (вне ядра). */
export type ChannelDeliverer = (
  provider: OAuthProvider,
  title: string,
  body: string,
  recipient: ChannelDeliveryRecipient | null,
) => Promise<void>;

/** Итог прохода диспетчера. */
export interface DispatchDeliveriesResult {
  /** Доставлено живым адаптером. */
  readonly sent: number;
  /** Закрыто в демо-режиме (адаптера нет). */
  readonly demo: number;
  /** Сбой доставки, текст ошибки сохранён. */
  readonly failed: number;
  /** Сколько записей было выдано на этот проход. */
  readonly processed: number;
}

/**
 * Ставит уведомление в outbox всех привязанных каналов пользователя.
 *
 * userId приходит из сервиса кабинета (уведомление адресуется
 * пользователю), а не из запроса: каналы определяются только реальными
 * привязками OAuthAccount. Возвращает созданные записи — вызывающий код
 * может показать, в какие каналы ушло уведомление.
 */
export async function enqueueChannelDeliveries(
  userId: string,
  input: ChannelDeliveryInput,
): Promise<ChannelDeliveryItem[]> {
  if (typeof userId !== 'string' || userId === '') {
    throw new TypeError('Outbox: userId обязателен.');
  }
  const title = input.title.trim();
  const body = deliveryBody(input.body, input.link);
  if (title === '' || body === '') {
    throw new TypeError('Outbox: заголовок и текст уведомления обязательны.');
  }

  const accounts = await prisma().oAuthAccount.findMany({
    where: { userId },
    select: { provider: true },
    orderBy: { provider: 'asc' },
  });

  const items: ChannelDeliveryItem[] = [];
  for (const account of accounts) {
    const created = await prisma().channelDelivery.create({
      data: { userId, provider: account.provider, title, body, status: 'PENDING' },
    });
    items.push(toItem(created));
  }
  return items;
}

/**
 * Ставит уведомление в outbox каналов, НЕ роняя вызывающий код.
 *
 * ЗАЧЕМ ОБЁРТКА: уведомление на сайте — источник истины, а канал лишь
 * копия. Если outbox упал (БД, отвязанный аккаунт, любая причина),
 * отменять создание уведомления и ответ пользователю нельзя: студент
 * должен увидеть статус заявки в кабинете даже без доставки в мессенджер.
 * Поэтому сервисы кабинета вызывают эту функцию, а сбой остаётся одной
 * строкой в логе (context — что делали, когда сбой произошёл).
 */
export async function enqueueChannelDeliveriesSafely(
  userId: string,
  input: ChannelDeliveryInput,
  context: string,
): Promise<void> {
  try {
    await enqueueChannelDeliveries(userId, input);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`[channels] ${context}: доставка в каналы не поставлена (${detail})`);
  }
}

/** Свои доставки в каналы: кабинет показывает их как «сообщения в канале». */
export async function listChannelInbox(session: AuthSession): Promise<ChannelDeliveryItem[]> {
  const user = requireUser(session);
  const deliveries = await prisma().channelDelivery.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: CHANNEL_INBOX_LIMIT,
  });
  return deliveries.map(toItem);
}

/**
 * Разбирает очередь PENDING-записей.
 *
 * Адаптер не передан (демо-режим: токенов бота в env нет) — записи
 * закрываются статусом DEMO. Живой адаптер передаёт функцию доставки;
 * каждая запись закрывается отдельно, поэтому один сбой не останавливает
 * очередь, а условие status = PENDING в updateMany не даёт закрыть запись,
 * которую уже забрал другой проход.
 */
export async function dispatchPendingDeliveries(
  deliver?: ChannelDeliverer | null,
  limit: number = DISPATCH_BATCH_SIZE,
): Promise<DispatchDeliveriesResult> {
  const pending = await prisma().channelDelivery.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, userId: true, provider: true, title: true, body: true },
  });

  // Адаптера нет (демо-режим: токены бота не заданы) — очередь закрывается
  // статусом DEMO, а не молча теряется и не притворяется доставленной.
  if (deliver === null || deliver === undefined) {
    const demo = await prisma().channelDelivery.updateMany({
      where: { id: { in: pending.map((item) => item.id) }, status: 'PENDING' },
      data: { status: 'DEMO', sentAt: new Date() },
    });
    return { sent: 0, demo: demo.count, failed: 0, processed: pending.length };
  }

  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    // Получатель — из той же привязки, по которой запись создана: без него
    // адаптер канала не знает, в какой чат писать (см. ChannelDeliveryRecipient).
    const recipient = await recipientFor(item.userId, item.provider);
    try {
      await deliver(item.provider, item.title, item.body, recipient);
      const updated = await prisma().channelDelivery.updateMany({
        where: { id: item.id, status: 'PENDING' },
        data: { status: 'SENT', sentAt: new Date() },
      });
      if (updated.count > 0) {
        sent += 1;
      }
    } catch (error) {
      const updated = await prisma().channelDelivery.updateMany({
        where: { id: item.id, status: 'PENDING' },
        data: { status: 'FAILED', error: sanitizeDeliveryError(error) },
      });
      if (updated.count > 0) {
        failed += 1;
      }
    }
  }

  return { sent, demo: 0, failed, processed: pending.length };
}

/**
 * Текст ошибки для БД: только первая строка и с ограничением длины.
 *
 * ЗАЧЕМ ТАК: сообщения сетевых ошибок нередко содержат URL (а токен бота
 * в Bot API — часть URL) и заголовки. В error уходит единственная строка
 * без адреса запроса: её достаточно для диагностики в кабинете, и в ней
 * нет секретов.
 */
function sanitizeDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0] ?? '';
  return firstLine.slice(0, MAX_DELIVERY_ERROR_LENGTH);
}

/**
 * Идентификатор аккаунта канала для записи outbox: providerAccountId
 * привязки (userId, provider). null — привязки нет (канал отвязан после
 * постановки в очередь): отправлять некуда, и подставлять чужой или
 * выдуманный идентификатор нельзя.
 */
async function recipientFor(
  userId: string,
  provider: OAuthProvider,
): Promise<ChannelDeliveryRecipient | null> {
  const account = await prisma().oAuthAccount.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { providerAccountId: true },
  });
  if (account === null) {
    return null;
  }
  return { userId, channelUserId: account.providerAccountId };
}

/** Текст сообщения канала: ссылка кабинета дописывается строкой. */
function deliveryBody(body: string, link?: string | null): string {
  const text = body.trim();
  const target = link?.trim();
  if (target === undefined || target === null || target === '') {
    return text;
  }
  return text.includes(target) ? text : `${text}\n${target}`;
}

function toItem(record: {
  id: string;
  provider: OAuthProvider;
  title: string;
  body: string;
  status: ChannelDeliveryStatus;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
}): ChannelDeliveryItem {
  return {
    id: record.id,
    channel: botChannelForProvider(record.provider),
    provider: record.provider,
    title: record.title,
    body: record.body,
    status: record.status,
    error: record.error,
    createdAt: record.createdAt,
    sentAt: record.sentAt,
  };
}

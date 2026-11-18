/**
 * Диспетчер доставки уведомлений в каналы доступа (BRIEF v3).
 *
 * ЗАЧЕМ: кабинет создаёт уведомление студенту (сайт — источник истины) и
 * ставит копию в outbox каждого привязанного канала (enqueueChannelDeliveries).
 * Разбирать очередь должен кто-то один раз в интервал — этот модуль. Он
 * вызывается из instrumentation (apps/web/instrumentation.ts): публичного
 * рота у диспетчера НЕТ намеренно, иначе любой мог бы запускать рассылку
 * и превращать её в флуд-канал.
 *
 * Демо-режим честен:
 * - токенов ботов в env нет вовсе → dispatchPendingDeliveries вызывается
 *   без доставщика, и ядро закрывает очередь статусом DEMO (записи не
 *   теряются и не притворяются доставленными);
 * - токен есть хотя бы у одного канала → записи уходят живым адаптерам
 *   (sendChannelText), а провайдер без адаптера получает отказ с текстом
 *   «канал не подключён» и статус FAILED: отправлять некуда, и притворяться
 *   доставкой нельзя. Такой канал виден в inbox студента со статусом и
 *   причиной — его можно переотправить, подключив токен.
 */
import { BOT_CHANNELS, dispatchPendingDeliveries, type DispatchDeliveriesResult } from '@udgu/core';
import { getChannelAdapters, sendChannelText } from './adapters';

/** Живые адаптеры процесса: канал с токеном в env. */
function liveChannelCount(): number {
  const { adapters } = getChannelAdapters();
  return BOT_CHANNELS.filter((channel) => adapters[channel] !== null).length;
}

/**
 * Один проход очереди outbox.
 *
 * Никогда не бросает: сбой диспетчера не должен ронять процесс сервера
 * (интервал в instrumentation продолжает работать). Результат возвращается
 * для лога и тестов.
 */
export async function runChannelDispatch(): Promise<DispatchDeliveriesResult> {
  try {
    // Ни одного токена в env — демо-режим целиком: ядро закроет очередь
    // статусом DEMO (адаптер не передан).
    if (liveChannelCount() === 0) {
      return await dispatchPendingDeliveries(null);
    }
    return await dispatchPendingDeliveries(sendChannelText);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`[bot:dispatch] проход очереди не удался: ${detail}`);
    return { sent: 0, demo: 0, failed: 0, processed: 0 };
  }
}

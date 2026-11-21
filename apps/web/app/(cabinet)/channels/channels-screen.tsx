/**
 * Экран «Каналы» (BRIEF v3 «Каналы доступа»).
 *
 * Один кабинет в трёх каналах: сайт, Telegram-бот, VK-бот, MAX-бот — на
 * общем бэкенде и общей БД. Экран отвечает на три вопроса студента:
 * 1. в каком режиме канал («подключён» / «демо-режим» — честная пометка,
 *    без притворства доставкой);
 * 2. привязан ли канал к моей учётной записи (и как привязать — кодом
 *    из кабинета, той же командой /link, что принимает бот);
 * 3. какие уведомления ушли в мои каналы (inbox outbox).
 *
 * Симулятор (ChannelSimulator) — клиентский остров: он действует от
 * сессии, но через тот же handleBotCommand, что и живой бот. Список
 * уведомлений рендерит сервер из тех же сервисов ядра, что и /api/bot/inbox.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { BOT_CHANNEL_LABELS } from '@udgu/core/bot';
import type { ChannelDeliveryItem } from '@udgu/core';
import { Card, EmptyState, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { formatMoment } from '../../../components/format';
import { IconChannels } from '../../../components/icons';
import { TEXT_LINK_CLASS } from '../../../lib/ui';
import { loadChannelsPageData, type ChannelsPageData, type LoadResult } from '../../../lib/page-data';
import { ChannelSimulator } from './ChannelSimulator';

/** Статус доставки: цвет ВСЕГДА со словом (требование доступности). */
const DELIVERY_STATUS: Readonly<
  Record<ChannelDeliveryItem['status'], { label: string; tone: 'neutral' | 'success' | 'danger' }>
> = {
  PENDING: { label: 'Ждёт отправки', tone: 'neutral' },
  SENT: { label: 'Доставлено', tone: 'success' },
  // Демо-режим честен: запись закрыта как демо, а не как доставленная.
  DEMO: { label: 'Демо-режим', tone: 'neutral' },
  FAILED: { label: 'Сбой доставки', tone: 'danger' },
};

/** Запись inbox: канал, заголовок, текст, статус и время. */
function DeliveryCard({ delivery }: { delivery: ChannelDeliveryItem }): React.JSX.Element {
  const status = DELIVERY_STATUS[delivery.status];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-muted">
          {delivery.channel === null ? 'Канал' : BOT_CHANNEL_LABELS[delivery.channel]}
        </span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <p className="ml-auto text-xs text-text-muted">{formatMoment(new Date(delivery.createdAt))}</p>
      </div>
      <h3 className="mt-1.5 text-sm font-semibold text-text">{delivery.title}</h3>
      <p className="mt-0.5 whitespace-pre-line text-sm text-text-muted">{delivery.body}</p>
      {delivery.error === null ? null : (
        <p className="mt-1 text-xs text-danger">Причина: {delivery.error}</p>
      )}
    </Card>
  );
}

export function ChannelsView({ result }: { result: LoadResult<ChannelsPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader title="Каналы" subtitle="Кабинет в Telegram, VK и MAX" />

          <ChannelSimulator statuses={data.statuses} linked={data.linked} />

          <section aria-labelledby="channel-inbox">
            <h2 id="channel-inbox" className="mb-2 text-base font-semibold text-text">
              Уведомления в каналах
            </h2>
            {data.inbox.length === 0 ? (
              <EmptyState
                title="Уведомлений в каналах нет"
                description="Сообщение преподавателя, решение по заявке, объявление и перенос пары приходят и в канал."
                icon={<IconChannels />}
              />
            ) : (
              <ul className="space-y-3" data-testid="channel-inbox">
                {data.inbox.map((delivery) => (
                  <li key={delivery.id}>
                    <DeliveryCard delivery={delivery} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-4 text-sm text-text-muted">
            Команды бота те же, что и разделы кабинета:{' '}
            <Link href="/assistant" className={TEXT_LINK_CLASS}>
              ассистент
            </Link>{' '}
            отвечает по вашим данным.
          </p>
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function ChannelsScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadChannelsPageData(cookieStore.toString());
  return <ChannelsView result={result} />;
}

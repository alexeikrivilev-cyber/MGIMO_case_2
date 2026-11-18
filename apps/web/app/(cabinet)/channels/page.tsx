import { ChannelsScreen } from './channels-screen';

/**
 * /channels — каналы доступа (BRIEF v3 «Каналы доступа»).
 *
 * Один и тот же кабинет в трёх каналах: сайт, Telegram-бот, VK-бот,
 * MAX-бот — на общем бэкенде. Экран показывает режим каждого канала
 * (live / демо-режим), позволяет привязать канал к учётной записи кодом
 * и показывает уведомления, доставленные в каналы.
 */
export default function ChannelsPage(): React.JSX.Element {
  return <ChannelsScreen />;
}

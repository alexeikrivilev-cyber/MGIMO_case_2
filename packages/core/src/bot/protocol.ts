/**
 * Протокол каналов доступа (BRIEF v3 «Каналы доступа»): Telegram, VK, MAX.
 *
 * Это СЛОВАРЬ каналов, а не адаптер: типы здесь не зависят ни от БД, ни
 * от HTTP, ни от SDK конкретного мессенджера. Адаптеры каналов (куда
 * девать long-polling и токены из env) живут вне ядра и вызывают
 * handleBotCommand из ./commands — вся бизнес-логика уже в сервисах
 * кабинета, бот её не дублирует.
 *
 * Канал ≠ учётная запись. Один и тот же кабинет доступен из трёх каналов,
 * и идентичность канала выражается существующей OAuthAccount
 * (provider + providerAccountId): второй стороны идентичностей в проекте
 * нет намеренно.
 */

/**
 * Канал доступа. Имена — нейтральные (не «tg-бот»): адаптер канала
 * переводит их в свои константы, ядро оперирует только этими тремя.
 */
export type BotChannel = 'telegram' | 'vk' | 'max';

/** Все каналы доступа (для адаптеров и проверок). */
export const BOT_CHANNELS: readonly BotChannel[] = ['telegram', 'vk', 'max'];

/** Человекочитаемые названия каналов (ответы бота, UI кабинета). */
export const BOT_CHANNEL_LABELS: Readonly<Record<BotChannel, string>> = {
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
};

/**
 * Провайдер OAuth канала доступа. Тип выведен из модели идентичности
 * (`OAuthProvider` в packages/db), но здесь он — чистая структурная
 * union: модуль не импортирует БД даже типами.
 */
export type ChannelProvider = 'VK_ID' | 'MAX' | 'TELEGRAM';

/** Канал → провайдер OAuth: связь канала с учётной записью. */
const PROVIDER_BY_CHANNEL: Readonly<Record<BotChannel, ChannelProvider>> = {
  telegram: 'TELEGRAM',
  vk: 'VK_ID',
  max: 'MAX',
};

/**
 * Провайдер OAuth, через который канал связывается с учётной записью.
 * TELEGRAM-бот и VK-бот студента — одна и та же УЗ, если оба канала
 * привязаны (OAuthAccount на каждого провайдера).
 */
export function botChannelProvider(channel: BotChannel): ChannelProvider {
  return PROVIDER_BY_CHANNEL[channel];
}

/** Является ли строка именем канала (граница ввода адаптера). */
export function isBotChannel(value: unknown): value is BotChannel {
  return typeof value === 'string' && (BOT_CHANNELS as readonly string[]).includes(value);
}

/** Обратный маппинг: провайдер OAuth → канал (null — провайдер не канал). */
export function botChannelForProvider(provider: ChannelProvider): BotChannel | null {
  const found = BOT_CHANNELS.find((channel) => PROVIDER_BY_CHANNEL[channel] === provider);
  return found ?? null;
}

/**
 * Обновление из канала: что канал передал ядру. channelUserId —
 * идентификатор аккаунта в мессенджере (из данных провайдера), он же
 * providerAccountId в OAuthAccount. Никаких токенов и секретов здесь нет.
 */
export interface BotUpdate {
  readonly channel: BotChannel;
  readonly channelUserId: string;
  readonly text: string;
}

/** Ответ каналу: одно сообщение мессенджера. */
export interface BotReply {
  readonly text: string;
}

/** Максимум сообщений в ответ на одну команду (анти-флуд в канал). */
export const MAX_BOT_REPLIES = 10;

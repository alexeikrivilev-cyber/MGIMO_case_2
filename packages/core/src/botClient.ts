/**
 * Клиентские константы каналов доступа (BRIEF v3).
 *
 * Отдельный лист-модуль: браузерный код кабинета (симулятор каналов на
 * /channels) импортирует его подпутем `@udgu/core/bot` и не тянет в
 * клиентский бандл ядро с доступом к БД (Prisma, argon2, сервисы).
 *
 * Единственный источник истины — bot/protocol.ts: он не имеет импортов
 * вовсе (словарь каналов), поэтому реэкспорт безопасен для браузера.
 */
export {
  BOT_CHANNELS,
  BOT_CHANNEL_LABELS,
  botChannelForProvider,
  botChannelProvider,
  isBotChannel,
} from './bot/protocol';
export type { BotChannel, BotReply, BotUpdate, ChannelProvider } from './bot/protocol';

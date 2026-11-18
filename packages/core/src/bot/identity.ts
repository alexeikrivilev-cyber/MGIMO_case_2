/**
 * Идентификация пользователя в каналах доступа (BRIEF v3).
 *
 * ЗАЧЕМ: бот должен работать с ТОЙ ЖЕ учётной записью, что и сайт, и не
 * иметь своей копии правил доступа. Здесь только два вопроса:
 *   1. какой userId владеет аккаунтом канала (resolveChannelUser);
 *   2. как аккаунт канала привязать к учётной записи (код из кабинета).
 *
 * Владение данными НЕ проверяется здесь: сервисы кабинета принимают
 * AuthSession и сами резолвят студента/пользователя из неё (правило
 * ownership.ts). Модуль лишь доставляет корректную сессию.
 *
 * Связь «канал → пользователь» хранится в существующей OAuthAccount
 * (provider + providerAccountId). Второй стороны идентичностей в проекте
 * нет: регистрация через VK ID / MAX / Telegram на сайте и привязка
 * бота — одна и та же сущность.
 */
import { randomInt } from 'node:crypto';
import { prisma } from '../db';
import { OwnershipError, ValidationError } from '../errors';
import { requireUser } from '../ownership';
import { writeAuditEvent } from '../audit';
import type { AuthSession } from '../session';
import { botChannelProvider, type BotChannel } from './protocol';
import type { OAuthProvider } from '@udgu/db';

/** Длина кода привязки (символов). */
export const BOT_LINK_CODE_LENGTH = 6;

/** Время жизни кода привязки, миллисекунды (10 минут). */
export const BOT_LINK_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Алфавит кода БЕЗ неоднозначных символов: 0/O, 1/I/L выглядят в
 * мессенджере одинаково, и студент пришлёт боту не тот код. Оставшиеся
 * 32 символа дают 32^6 ≈ 1.1 млрд вариантов при 10-минутной жизни.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Сколько раз пытаемся подобрать свободный код при коллизии. */
const CODE_ATTEMPTS = 5;

/** Выданный код привязки: что показать студенту в кабинете. */
export interface CreatedBotLinkCode {
  readonly code: string;
  readonly expiresAt: Date;
}

/** Результат привязки канала к учётной записи. */
export interface ChannelLinkResult {
  readonly userId: string;
  readonly login: string;
  /** true — связь создана; false — канал уже был привязан (идемпотентно). */
  readonly created: boolean;
}

/**
 * Сессия для вызовов сервисов кабинета из канала.
 *
 * ПОЧЕМУ БЕЗ ЗАПИСИ В Session (осознанно):
 * - Команда из канала исполняется от userId, выведенного из таблицы связи
 *   канал→пользователь (OAuthAccount), которую наполняет только
 *   consumeBotLinkCode по коду из кабинета. Подделать channelUserId =
 *   подделать ответ провайдера; в прототипе провайдер эмулируется, но
 *   контракт тот же, что и в продакшене.
 * - Все данные сервисы кабинета резолвят из сессии сами и проверяют
 *   владение (ownership.ts): даже некорректная сессия не открывает чужие
 *   оценки, заявки или переписку.
 * - Сессия в Session — это предъявляемый токен (cookie). У команды из
 *   канала нет предъявляемого токена: писать в Session строку без
 *   токена значит заводить неотзываемые «вечные» сессии, которые никто
 *   не сможет погасить (revokeSession работает по токену), и раздувать
 *   таблицу сессиями на каждый апдейт бота.
 *
 * Сессия синтетическая и живёт РОВНО один вызов команды: expiresAt —
 * текущий момент. Поля session не используются сервисами ядра (только
 * маршрутами web для отображения информации о сессии), поэтому
 * дополнительного соглашения о них не требуется.
 */
export async function botSessionFor(userId: string, channel?: BotChannel): Promise<AuthSession> {
  const user = await prisma().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      login: true,
      role: true,
      faculty: true,
      student: { select: { id: true } },
      teacher: { select: { id: true } },
    },
  });
  if (user === null) {
    // Учётная запись удалена, а привязка канала осталась: для ядра это
    // тот же случай, что «сессии нет».
    throw new OwnershipError('UNAUTHENTICATED', 'Учётная запись не найдена.');
  }

  const now = new Date();
  return {
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      faculty: user.faculty,
      studentId: user.student?.id ?? null,
      teacherId: user.teacher?.id ?? null,
    },
    session: {
      id: `bot:${channel ?? 'channel'}:${user.id}`,
      userId: user.id,
      expiresAt: now,
      createdAt: now,
      ip: null,
      userAgent: channel === undefined ? 'bot' : `bot:${channel}`,
    },
  };
}

/**
 * userId по аккаунту канала, или null если канал не привязан.
 *
 * Ищем по providerAccountId (уникальный индекс) и проверяем провайдера:
 * канал определяет провайдера однозначно, поэтому «telegram-идентификатор,
 * пришедший в vk» привязкой не считается.
 */
export async function resolveChannelUser(
  channel: BotChannel,
  channelUserId: string,
): Promise<string | null> {
  const provider = botChannelProvider(channel);
  const accountId = channelUserId.trim();
  if (accountId === '') {
    return null;
  }
  const account = await prisma().oAuthAccount.findUnique({
    where: { providerAccountId: accountId },
    select: { userId: true, provider: true },
  });
  if (account === null || account.provider !== provider) {
    return null;
  }
  return account.userId;
}

/** Случайный код из алфавита без неоднозначных символов. */
function randomLinkCode(): string {
  let code = '';
  for (let position = 0; position < BOT_LINK_CODE_LENGTH; position += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Выдаёт код привязки канала владельцу сессии (страница «Каналы» кабинета).
 *
 * provider — если код выдан для конкретного канала (botChannelProvider);
 * undefined — код принимается любым каналом. Предыдущие непогашенные коды
 * пользователя гасятся: в кабинете виден один актуальный код, а старые
 * нельзя использовать повторно.
 */
export async function createBotLinkCode(
  session: AuthSession,
  provider?: OAuthProvider,
): Promise<CreatedBotLinkCode> {
  const user = requireUser(session);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + BOT_LINK_CODE_TTL_MS);

  await prisma().botLinkCode.updateMany({
    where: { userId: user.id, consumedAt: null },
    data: { consumedAt: now },
  });

  let lastCode: string | null = null;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = randomLinkCode();
    const taken = await prisma().botLinkCode.findUnique({
      where: { code },
      select: { code: true },
    });
    if (taken === null) {
      lastCode = code;
      break;
    }
  }
  if (lastCode === null) {
    // Практически невозможно (32^6 вариантов), но честный отказ лучше
    // записи с коллизией: студент просто запросит код ещё раз.
    throw new ValidationError('CONFLICT', 'Не удалось выдать код привязки. Попробуйте ещё раз.');
  }

  await prisma().botLinkCode.create({
    data: { code: lastCode, userId: user.id, provider: provider ?? null, expiresAt },
  });

  return { code: lastCode, expiresAt };
}

/**
 * Привязывает аккаунт канала к учётной записи по коду из кабинета
 * (команда /link).
 *
 * Правила:
 * - код должен существовать, быть непогашенным и не просроченным;
 * - код, выданный на другой канал, не принимается;
 * - providerAccountId, уже занятый ДРУГИМ пользователем, — отказ
 *   (иначе чужие сообщения канала утекали бы в чужой кабинет);
 * - повторная привязка того же пользователя идемпотентна (created=false):
 *   студент может нажать /link дважды, в том числе из другого канала;
 * - код одноразовый: гасится в том же запросе, что создаёт связь
 *   (updateMany с условием consumedAt = null исключает гонку).
 */
export async function consumeBotLinkCode(
  code: string,
  channel: BotChannel,
  channelUserId: string,
): Promise<ChannelLinkResult> {
  const provider = botChannelProvider(channel);
  const normalizedCode = code.trim().toUpperCase();
  if (!new RegExp(`^[${CODE_ALPHABET}]{${BOT_LINK_CODE_LENGTH}}$`).test(normalizedCode)) {
    throw new ValidationError('INVALID_INPUT', 'Код привязки нераспознан.');
  }

  const accountId = channelUserId.trim();
  if (accountId === '') {
    throw new ValidationError('INVALID_INPUT', 'Канал не сообщил идентификатор аккаунта.');
  }

  const now = new Date();
  const record = await prisma().botLinkCode.findUnique({
    where: { code: normalizedCode },
    select: {
      code: true,
      userId: true,
      provider: true,
      expiresAt: true,
      consumedAt: true,
      user: { select: { login: true } },
    },
  });
  if (
    record === null ||
    record.consumedAt !== null ||
    record.expiresAt.getTime() <= now.getTime()
  ) {
    throw new ValidationError(
      'INVALID_INPUT',
      'Код привязки недействителен или устарел. Получите новый в кабинете.',
    );
  }
  if (record.provider !== null && record.provider !== provider) {
    throw new ValidationError(
      'INVALID_INPUT',
      'Код выдан для другого канала. Получите код в разделе этого канала.',
    );
  }
  const login = record.user.login;

  // Существующая привязка этого аккаунта мессенджера.
  const existingByAccount = await prisma().oAuthAccount.findUnique({
    where: { providerAccountId: accountId },
    select: { userId: true, provider: true },
  });
  if (existingByAccount !== null) {
    if (existingByAccount.userId !== record.userId) {
      throw new ValidationError(
        'CONFLICT',
        'Этот аккаунт канала уже привязан к другому пользователю. Обратитесь в деканат.',
      );
    }
    if (existingByAccount.provider !== provider) {
      throw new ValidationError(
        'CONFLICT',
        'Этот аккаунт уже привязан в другом канале. Обратитесь в деканат.',
      );
    }
    await burnBotLinkCode(record.code);
    return { userId: record.userId, login, created: false };
  }

  // Канал уже привязан к этой учётной записи другим аккаунтом: молча
  // переписывать нельзя — студент потерял бы доступ из старого чата.
  const existingByUser = await prisma().oAuthAccount.findUnique({
    where: { userId_provider: { userId: record.userId, provider } },
    select: { providerAccountId: true },
  });
  if (existingByUser !== null) {
    throw new ValidationError(
      'CONFLICT',
      'К кабинету уже привязан другой аккаунт этого канала. Обратитесь в деканат.',
    );
  }

  const account = await prisma().oAuthAccount.create({
    data: { userId: record.userId, provider, providerAccountId: accountId },
    select: { id: true },
  });
  await burnBotLinkCode(record.code);
  await writeAuditEvent({
    actorUserId: record.userId,
    action: 'channel.link',
    entity: 'OAuthAccount',
    entityId: account.id,
    meta: { channel, provider },
  });

  return { userId: record.userId, login, created: true };
}

/**
 * Гасит код привязки. Условие consumedAt = null делает гашение
 * атомарным: при гонке двух /link с одним кодом второй получит отказ.
 */
async function burnBotLinkCode(code: string): Promise<void> {
  const burned = await prisma().botLinkCode.updateMany({
    where: { code, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (burned.count === 0) {
    throw new ValidationError(
      'INVALID_INPUT',
      'Код привязки уже использован. Получите новый в кабинете.',
    );
  }
}

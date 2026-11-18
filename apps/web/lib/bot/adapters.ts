/**
 * Адаптеры каналов доступа (BRIEF v3 «Каналы доступа»): Telegram, VK, MAX.
 *
 * ЗАЧЕМ ЭТОТ МОДУЛЬ: ядро ботов (packages/core/src/bot) не знает ни про
 * сеть, ни про SDK мессенджеров, ни про env — оно принимает BotUpdate и
 * возвращает BotReply. Здесь живёт единственное место, где канал говорит
 * с внешним миром: приём обновлений (long-polling) на входе, отправка
 * ответа на выходе и отправка уведомлений из outbox.
 *
 * ГЛАВНЫЕ ПРАВИЛА:
 * 1. Токен — ТОЛЬКО из env и только в этом модуле. Он не логируется, не
 *    попадает в ответы API и не попадает в клиентский бандл: клиентским
 *    компонентам уходит статус канала ('live' | 'demo'), а не адаптер.
 * 2. Канал без токена не создаётся вовсе: getChannelAdapters помечает его
 *    'demo', и диспетчер закрывает такие записи статусом DEMO (честная
 *    пометка, а не фейк-доставка).
 * 3. Ошибка сети не роняет процесс: цикл опроса переживает сбой одной
 *    строкой в лог и повторяет попытку.
 * 4. start()/stop() идемпотентны: повторный start не плодит второй цикл
 *    опроса, stop гасит текущий (в том числе отменяя висящий запрос).
 *
 * Модуль серверный: его импортируют диспетчер, instrumentation и серверные
 * загрузчики страниц. Клиентский бандл его не видит.
 */
import {
  BOT_CHANNELS,
  botChannelForProvider,
  handleBotCommand,
  type BotChannel,
  type ChannelDeliveryRecipient,
  type ChannelProvider,
} from '@udgu/core';
import type { OAuthProvider } from '@udgu/db';

/** Режим канала: live — токен в env, адаптер работает; demo — демо-режим. */
export type ChannelMode = 'live' | 'demo';

/** Подменяемый fetch: в проде — глобальный, в тестах — заглушка. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Пауза цикла опроса после сетевого сбоя. */
const POLL_RETRY_DELAY_MS = 5000;

/**
 * Пауза после ответа без обновлений.
 *
 * ЗАЧЕМ: long-polling держит соединение, пока нет событий (до 30 с), и
 * пауза почти никогда не срабатывает. Но если провайдер отвечает
 * мгновенно пустым ответом, без паузы цикл превратился бы в плотный
 * опрос API. Одна секунда — страховка от такого провайдера.
 */
const IDLE_POLL_DELAY_MS = 1000;

/**
 * Таймаут одного запроса к API канала. Заведомо больше таймаута
 * long-polling (30 с), иначе таймаут отменял бы нормальный ответ.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Таймаут long-polling: столько провайдер держит соединение без событий. */
const LONG_POLL_TIMEOUT_SECONDS = 30;

// ---------------------------------------------------------------------------
// Контракт адаптера
// ---------------------------------------------------------------------------

/** Адаптер канала: принять обновления, ответить, отправить уведомление. */
export interface ChannelAdapter {
  readonly channel: BotChannel;
  /** Провайдер OAuth, через который канал связан с учётной записью. */
  readonly provider: ChannelProvider;
  /** Запускает приём обновлений (идемпотентно). */
  start(): void;
  /** Останавливает приём обновлений (идемпотентно). */
  stop(): void;
  /** Отправляет текст сообщения аккаунту канала (channelUserId). */
  sendText(channelUserId: string, text: string): Promise<void>;
}

export interface ChannelAdapters {
  /** Живые адаптеры по каналам; null — канал в демо-режиме. */
  readonly adapters: Readonly<Record<BotChannel, ChannelAdapter | null>>;
  /** Статус канала для интерфейса: 'live' — подключён, 'demo' — демо-режим. */
  readonly statuses: Readonly<Record<BotChannel, ChannelMode>>;
}

// ---------------------------------------------------------------------------
// Сеть и ошибки
// ---------------------------------------------------------------------------

/**
 * Ошибка канала. Сообщение намеренно БЕЗ адреса запроса: в Bot API токен —
 * часть URL, и он не должен утекать ни в лог, ни в БД (dispatchPendingDeliveries
 * пишет первую строку ошибки в ChannelDelivery.error).
 */
class ChannelApiError extends Error {
  constructor(channel: string, detail: string) {
    super(`Канал ${channel}: ${detail}`);
    this.name = 'ChannelApiError';
  }
}

/** Ошибка отмены запроса (не сбой: канал остановили). */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Таймаут запроса + внешний сигнал отмены (stop цикла опроса). */
function withTimeout(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined || signal === null ? timeout : AbortSignal.any([timeout, signal]);
}

/** JSON-запрос к API канала; ответ приводится к результату метода. */
async function callChannelApi<T>(
  channel: BotChannel,
  input: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<T> {
  const response = await fetchImpl(input, { ...init, signal: withTimeout(init.signal) });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: T; error?: string; description?: string }
    | null;
  if (!response.ok) {
    throw new ChannelApiError(channel, `HTTP ${response.status}`);
  }
  if (payload === null) {
    throw new ChannelApiError(channel, 'ответ API не разобран');
  }
  if (payload.ok === false) {
    throw new ChannelApiError(channel, payload.description ?? payload.error ?? 'отказ API');
  }
  // Telegram/VK отдают результат в result; MAX-совместимые ответы — телом.
  return (payload.result ?? (payload as T)) as T;
}

/** Пауза цикла опроса после сбоя. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Одна строка в лог: канал и сообщение, без адреса запроса и токена. */
function logChannelIssue(channel: BotChannel, message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
  console.warn(`[bot:${channel}] ${message}: ${detail}`);
}

/** Обновление канала → ответы ядра: одна точка входа для всех адаптеров. */
function commandReplies(update: {
  channel: BotChannel;
  channelUserId: string;
  text: string;
}): ReturnType<typeof handleBotCommand> {
  return handleBotCommand(update);
}

// ---------------------------------------------------------------------------
// База адаптера с long-polling
// ---------------------------------------------------------------------------

/**
 * Общая часть адаптеров, принимающих обновления опросом.
 *
 * Цикл жизни: start() поднимает «поколение» цикла, stop() повышает
 * счётчик — все прошлые поколения выходят на ближайшей проверке, а висящий
 * запрос отменяется. Поэтому повторный start не удваивает опрос, а stop
 * гарантированно гасит цикл. Любая ошибка запроса логируется одной
 * строкой и не покидает цикл: сеть не роняет процесс.
 */
abstract class PollingChannelAdapter implements ChannelAdapter {
  abstract readonly channel: BotChannel;
  abstract readonly provider: ChannelProvider;

  protected readonly fetchImpl: FetchLike;

  /** Текущее поколение цикла: stop/start меняют счётчик. */
  private generation = 0;
  private controller: AbortController | null = null;

  protected constructor(fetchImpl: FetchLike) {
    this.fetchImpl = fetchImpl;
  }

  start(): void {
    this.generation += 1;
    void this.poll(this.generation);
  }

  stop(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }

  /** Один круг опроса: получить обновления провайдера. */
  protected abstract fetchUpdates(signal: AbortSignal): Promise<readonly unknown[]>;

  /** Обновление → ответы ядра → отправка каждого ответа в чат. */
  protected abstract handleUpdate(update: unknown): Promise<void>;

  /** Отправка текста аккаунту канала: реализация у каждого провайдера. */
  abstract sendText(channelUserId: string, text: string): Promise<void>;

  private async poll(generation: number): Promise<void> {
    while (generation === this.generation) {
      try {
        const controller = new AbortController();
        this.controller = controller;
        const updates = await this.fetchUpdates(controller.signal);
        this.controller = null;
        // Обновления обрабатываются, даже если поколение сменилось (например,
        // повторный start): они уже получены, а offset у провайдера сдвинут —
        // отбросить их значит потерять команду студента. Остановка сюда не
        // попадает: stop отменяет запрос, и он падает AbortError.
        for (const update of updates) {
          await this.handleUpdate(update);
        }
        if (updates.length === 0) {
          // Провайдер ответил сразу и пусто — не долбим его в цикле.
          await sleep(IDLE_POLL_DELAY_MS);
        }
      } catch (error) {
        if (generation !== this.generation || isAbort(error)) {
          // Остановили намеренно — это не сбой.
          return;
        }
        logChannelIssue(this.channel, 'опрос прерван, повтор через паузу', error);
        await sleep(POLL_RETRY_DELAY_MS);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/** Обновление Telegram Bot API (узкая часть контракта: текстовое сообщение). */
interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly from?: { readonly id: number };
    readonly text?: string;
  };
}

/**
 * Telegram-бот: Bot API (https://api.telegram.org/bot<token>/<method>).
 *
 * Вход — long-polling getUpdates (offset = последний update_id + 1,
 * timeout 30 с: сервер держит соединение, пока нет событий). Выход —
 * sendMessage на каждый ответ ядра (handleBotCommand).
 */
export class TelegramAdapter extends PollingChannelAdapter {
  readonly channel = 'telegram' as const;
  readonly provider = 'TELEGRAM' as const;

  private readonly token: string;
  private offset = 0;

  constructor(token: string, fetchImpl: FetchLike = globalThis.fetch) {
    super(fetchImpl);
    this.token = token;
  }

  /** Адрес метода Bot API. Токен — часть адреса по контракту Telegram. */
  private methodUrl(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  protected async fetchUpdates(signal: AbortSignal): Promise<readonly TelegramUpdate[]> {
    const updates = await callChannelApi<readonly TelegramUpdate[]>(
      this.channel,
      this.methodUrl('getUpdates'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          offset: this.offset,
          timeout: LONG_POLL_TIMEOUT_SECONDS,
          allowed_updates: ['message'],
        }),
        signal,
      },
      this.fetchImpl,
    );
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id + 1);
    }
    return updates;
  }

  protected async handleUpdate(update: unknown): Promise<void> {
    const message = (update as TelegramUpdate).message;
    const chatId = message?.from?.id;
    const text = message?.text;
    if (chatId === undefined || text === undefined || text === '') {
      // Не текстовое обновление (фото, стикер, вход в группу): команды нет.
      return;
    }
    const channelUserId = String(chatId);
    const replies = await commandReplies({ channel: this.channel, channelUserId, text });
    for (const reply of replies) {
      await this.sendText(channelUserId, reply.text);
    }
  }

  async sendText(channelUserId: string, text: string): Promise<void> {
    await callChannelApi(
      this.channel,
      this.methodUrl('sendMessage'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: channelUserId, text, disable_web_page_preview: true }),
      },
      this.fetchImpl,
    );
  }
}

// ---------------------------------------------------------------------------
// VK
// ---------------------------------------------------------------------------

/** Параметры сервера длинных запросов VK (groups.getLongPollServer). */
interface VkLongPollServer {
  readonly server: string;
  readonly key: string;
  readonly ts: string;
}

/** Обновление VK Bot Long Poll API: новое сообщение. */
interface VkUpdate {
  readonly type: string;
  readonly object?: { readonly message?: { readonly from_id?: number; readonly text?: string } };
}

/** Ответ long-poll запроса: новые события либо код продления (failed). */
interface VkPollResponse {
  readonly ts?: string;
  readonly updates?: readonly VkUpdate[];
  readonly failed?: number;
}

/**
 * VK-бот: Bot Long Poll API групп (groups.getLongPollServer + a_check).
 *
 * Вход — сервер длинных запросов, который VK выдаёт по токену группы:
 * ts актуализируется каждым ответом, failed=1 означает «ts устарел»
 * (нужен новый сервер). Выход — messages.send.
 */
export class VkAdapter extends PollingChannelAdapter {
  readonly channel = 'vk' as const;
  readonly provider = 'VK_ID' as const;

  private readonly token: string;
  private readonly groupId: string | null;
  private server: VkLongPollServer | null = null;

  constructor(
    token: string,
    groupId: string | null = null,
    fetchImpl: FetchLike = globalThis.fetch,
  ) {
    super(fetchImpl);
    this.token = token;
    this.groupId = groupId;
  }

  private methodUrl(method: string): string {
    return `https://api.vk.com/method/${method}`;
  }

  /** Общие параметницы вызова методов VK: токен группы и версия API. */
  private methodParams(extra: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams({ access_token: this.token, v: '5.199', ...extra });
    if (this.groupId !== null) {
      params.set('group_id', this.groupId);
    }
    return params;
  }

  /** Получает (и запоминает) сервер длинных запросов. */
  private async longPollServer(): Promise<VkLongPollServer> {
    const server = await callChannelApi<VkLongPollServer>(
      this.channel,
      `${this.methodUrl('groups.getLongPollServer')}?${this.methodParams({}).toString()}`,
      { method: 'GET' },
      this.fetchImpl,
    );
    this.server = server;
    return server;
  }

  protected async fetchUpdates(signal: AbortSignal): Promise<readonly VkUpdate[]> {
    const server = this.server ?? (await this.longPollServer());
    const url =
      `${server.server}?act=a_check&key=${encodeURIComponent(server.key)}` +
      `&ts=${encodeURIComponent(server.ts)}&wait=${LONG_POLL_TIMEOUT_SECONDS}`;
    const response = await callChannelApi<VkPollResponse>(
      this.channel,
      url,
      { method: 'GET', signal },
      this.fetchImpl,
    );

    // failed=1 — ts устарел, нужен новый сервер; failed=2/3 — продлить ключ.
    if (response.failed !== undefined) {
      this.server = null;
      return [];
    }
    if (response.ts !== undefined) {
      this.server = { ...server, ts: response.ts };
    }
    return response.updates ?? [];
  }

  protected async handleUpdate(update: unknown): Promise<void> {
    const typed = update as VkUpdate;
    const message = typed.object?.message;
    const fromId = message?.from_id;
    const text = message?.text;
    if (typed.type !== 'message_new' || fromId === undefined || text === undefined || text === '') {
      return;
    }
    const channelUserId = String(fromId);
    const replies = await commandReplies({ channel: this.channel, channelUserId, text });
    for (const reply of replies) {
      await this.sendText(channelUserId, reply.text);
    }
  }

  async sendText(channelUserId: string, text: string): Promise<void> {
    const params = this.methodParams({
      peer_id: channelUserId,
      message: text,
      // random_id защищает от дублей при повторной отправке того же текста.
      random_id: String(Math.floor(Math.random() * 2 ** 31)),
    });
    await callChannelApi(
      this.channel,
      `${this.methodUrl('messages.send')}?${params.toString()}`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      this.fetchImpl,
    );
  }
}

// ---------------------------------------------------------------------------
// MAX
// ---------------------------------------------------------------------------

/** Обновление MAX Bot API (контракт семейства Bot API: сообщение). */
interface MaxUpdate {
  readonly update_id: number;
  readonly message?: { readonly chat?: { readonly id: number | string }; readonly text?: string };
}

/**
 * MAX-бот (max.ru, мессенджер VK): Bot API канала MAX.
 *
 * Вход — long-polling getUpdates, выход — sendMessage: канал описан
 * контрактом семейства Bot API. База адреса настраивается env
 * (MAX_API_URL), потому что в прототипе токена MAX нет и канал работает в
 * демо-режиме: при подключении реального бота при расхождении контракта
 * меняются только базовый адрес и имена методов, а маршрутизация команд,
 * владение данными и уведомления остаются общими с сайтом (packages/core).
 */
export class MaxAdapter extends PollingChannelAdapter {
  readonly channel = 'max' as const;
  readonly provider = 'MAX' as const;

  private readonly token: string;
  private readonly baseUrl: string;
  private offset = 0;

  constructor(token: string, baseUrl: string, fetchImpl: FetchLike = globalThis.fetch) {
    super(fetchImpl);
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private methodUrl(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  protected async fetchUpdates(signal: AbortSignal): Promise<readonly MaxUpdate[]> {
    const updates = await callChannelApi<readonly MaxUpdate[]>(
      this.channel,
      this.methodUrl('getUpdates'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offset: this.offset, timeout: LONG_POLL_TIMEOUT_SECONDS }),
        signal,
      },
      this.fetchImpl,
    );
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id + 1);
    }
    return updates;
  }

  protected async handleUpdate(update: unknown): Promise<void> {
    const message = (update as MaxUpdate).message;
    const chatId = message?.chat?.id;
    const text = message?.text;
    if (chatId === undefined || text === undefined || text === '') {
      return;
    }
    const channelUserId = String(chatId);
    const replies = await commandReplies({ channel: this.channel, channelUserId, text });
    for (const reply of replies) {
      await this.sendText(channelUserId, reply.text);
    }
  }

  async sendText(channelUserId: string, text: string): Promise<void> {
    await callChannelApi(
      this.channel,
      this.methodUrl('sendMessage'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: channelUserId, text }),
      },
      this.fetchImpl,
    );
  }
}

// ---------------------------------------------------------------------------
// Сборка набора адаптеров
// ---------------------------------------------------------------------------

/** Значение переменной окружения: пустая строка считается отсутствием. */
function envValue(name: string): string | null {
  const value = process.env[name];
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** База MAX Bot API: настраивается env, значение по умолчанию — botapi.max.ru. */
function maxApiBase(): string {
  return envValue('MAX_API_URL') ?? 'https://botapi.max.ru';
}

/** Создаёт набор адаптеров по переменным окружения процесса. */
function buildChannelAdapters(): ChannelAdapters {
  const telegramToken = envValue('TELEGRAM_BOT_TOKEN');
  const vkToken = envValue('VK_BOT_TOKEN');
  const maxToken = envValue('MAX_BOT_TOKEN');

  const adapters: Record<BotChannel, ChannelAdapter | null> = {
    telegram: telegramToken === null ? null : new TelegramAdapter(telegramToken),
    vk: vkToken === null ? null : new VkAdapter(vkToken, envValue('VK_BOT_GROUP_ID')),
    max: maxToken === null ? null : new MaxAdapter(maxToken, maxApiBase()),
  };

  const statuses = Object.fromEntries(
    BOT_CHANNELS.map((channel) => [channel, adapters[channel] === null ? 'demo' : 'live']),
  ) as Record<BotChannel, ChannelMode>;

  return { adapters, statuses };
}

/**
 * Адаптеры каналов процесса (singleton).
 *
 * ПОЧЕМУ СИНГЛТОН: набор каналов задаётся env при старте процесса и не
 * меняется. Запомненный набор гарантирует, что start()/stop() диспетчера
 * и отрисовка статусов говорят об ОДНИХ И ТЕХ ЖЕ адаптерах: новый
 * экземпляр на каждый вызов означал бы второй цикл long-polling.
 */
let cachedAdapters: ChannelAdapters | null = null;

export function getChannelAdapters(): ChannelAdapters {
  cachedAdapters ??= buildChannelAdapters();
  return cachedAdapters;
}

/** Запускает приём обновлений живых адаптеров (демо-каналы молчат). */
export function startChannelAdapters(): void {
  for (const channel of BOT_CHANNELS) {
    getChannelAdapters().adapters[channel]?.start();
  }
}

/** Останавливает приём обновлений (штатная остановка процесса, тесты). */
export function stopChannelAdapters(): void {
  for (const channel of BOT_CHANNELS) {
    getChannelAdapters().adapters[channel]?.stop();
  }
}

// ---------------------------------------------------------------------------
// Отправка уведомлений в канал (единая точка для диспетчера)
// ---------------------------------------------------------------------------

/**
 * ЕДИНАЯ точка отправки уведомления в канал: маршрутизирует провайдера
 * OAuth на живой адаптер и отправляет заголовок с текстом одним
 * сообщением.
 *
 * Сигнатура совпадает с ChannelDeliverer ядра (provider, title, body,
 * recipient), поэтому функция передаётся в dispatchPendingDeliveries
 * напрямую — без обёртки, которая бы дублировала маршрутизацию.
 *
 * Провайдер без живого адаптера (нет токена в env) или без получателя
 * (аккаунт канала отвязан) — отказ, а не молчаливый «успех»: демо-закрытие
 * очереди делает диспетчер целиком (dispatchPendingDeliveries без
 * доставщика → статус DEMO), здесь не притворяемся доставкой.
 *
 * Текст сообщения — без разметки: `<b>` и Markdown потребовали бы режима
 * разбора и экранирования, а канал должен показать ровно то, что создал
 * кабинет (уведомление на сайте — источник истины).
 */
export async function sendChannelText(
  provider: OAuthProvider,
  title: string,
  body: string,
  recipient: ChannelDeliveryRecipient | null,
): Promise<void> {
  const channel = botChannelForProvider(provider);
  if (channel === null) {
    throw new ChannelApiError(String(provider), 'провайдер не является каналом доступа');
  }
  const adapter = getChannelAdapters().adapters[channel];
  if (adapter === null) {
    throw new ChannelApiError(channel, 'канал не подключён: токен бота не задан (демо-режим)');
  }
  if (recipient === null) {
    throw new ChannelApiError(channel, 'аккаунт канала отвязан: отправлять некуда');
  }
  await adapter.sendText(recipient.channelUserId, `${title}\n${body}`);
}

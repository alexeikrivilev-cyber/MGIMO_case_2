'use client';

/**
 * Симулятор каналов доступа (BRIEF v3): Telegram / VK / MAX на странице
 * /channels.
 *
 * ЗАЧЕМ: сценарии каналов должны быть проходимы жюри end-to-end без
 * реальных токенов ботов (BRIEF v3 допускает демо-режим с честной
 * пометкой). Симулятор действует от СЕССИИ пользователя, но через ТОТ ЖЕ
 * handleBotCommand, что и живой бот: /schedule, /grades, /request,
 * /notifications отвечают данными владельца сессии и создают в кабинете
 * те же записи (общий бэкенд). Отличие ровно одно — идентификатор
 * аккаунта канала выводится из сессии (demo-<канал>-<userId>), а не
 * приходит от провайдера.
 *
 * Что показывает экран:
 * - три вкладки-канала с режимом: «подключён» (токен бота в env, адаптер
 *   работает) или «демо-режим» (токена нет — пометка честная, доставка
 *   не притворяется состоявшейся);
 * - первый вход в канал: код привязки и кнопка «Привязать» (/link <код>);
 * - ленту переписки с ботом и поле ввода команды.
 *
 * Статус привязки приходит с сервера (loadChannelsPageData проверяет ту же
 * OAuthAccount, по которой работает живой бот), поэтому после /link
 * страница перерисовывается и показывает «привязан» — состояние не живёт
 * только в памяти вкладки.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api, type BotChannelMode, type BotChannelName } from '../../../lib/api-client';
// Подпуть @udgu/core/bot — лист-модуль без Prisma: в клиентский бандл не
// попадает ядро с доступом к БД (как у ассистента, @udgu/core/assistant).
import { BOT_CHANNEL_LABELS } from '@udgu/core/bot';
import { Button, Card, EmptyState, StatusBadge, TextInput } from '../../../components/ui';
import { FOCUS_RING, PRESS_FEEDBACK } from '../../../lib/ui';
import { IconChannels } from '../../../components/icons';

/** Порядок вкладок — как в BRIEF v3: Telegram, VK, MAX. */
const CHANNELS: readonly BotChannelName[] = ['telegram', 'vk', 'max'];

/** Сообщение ленты: своё (команда) или ответ бота. */
interface ChatMessage {
  readonly id: string;
  readonly from: 'me' | 'bot';
  readonly text: string;
}

/** Счётчик идентификаторов сообщений ленты (ключи React, не данные). */
let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `m${messageSeq}`;
}

export function ChannelSimulator({
  statuses,
  linked,
}: {
  statuses: Readonly<Record<BotChannelName, BotChannelMode>>;
  linked: Readonly<Record<BotChannelName, boolean>>;
}): React.JSX.Element {
  const router = useRouter();
  const [active, setActive] = useState<BotChannelName>('telegram');
  const [logs, setLogs] = useState<Readonly<Record<BotChannelName, readonly ChatMessage[]>>>({
    telegram: [],
    vk: [],
    max: [],
  });
  const [code, setCode] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messages = logs[active];
  const isLinked = linked[active];
  const mode = statuses[active];

  /** Добавляет сообщение в ленту активного канала. */
  function append(from: ChatMessage['from'], body: string): void {
    const message: ChatMessage = { id: nextMessageId(), from, text: body };
    setLogs((current) => ({ ...current, [active]: [...current[active], message] }));
  }

  /** Отправляет команду боту: общий путь с живым ботом (handleBotCommand). */
  async function send(body: string): Promise<void> {
    const trimmed = body.trim();
    if (trimmed === '' || pending) {
      return;
    }
    append('me', trimmed);
    setText('');
    setPending(true);
    setError(null);
    try {
      const payload = await api.sendBotMessage(active, trimmed);
      for (const reply of payload.replies) {
        append('bot', reply);
      }
      // Статус привязки и inbox уведомлений — с сервера: он источник
      // истины и по общей OAuthAccount, а не по состоянию вкладки.
      router.refresh();
    } catch (sendError) {
      setError(
        sendError instanceof ApiClientError
          ? sendError.message
          : 'Не удалось отправить команду. Попробуйте снова.',
      );
    } finally {
      setPending(false);
    }
  }

  /** Код привязки из кабинета: выдаётся владельцу сессии на этот канал. */
  async function requestCode(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const payload = await api.createBotLinkCode(active);
      setCode(payload.code);
    } catch (codeError) {
      setError(
        codeError instanceof ApiClientError ? codeError.message : 'Не удалось получить код. Попробуйте снова.',
      );
    } finally {
      setPending(false);
    }
  }

  /** Привязка: та же команда /link, которую бот принимает из мессенджера. */
  async function link(): Promise<void> {
    if (code === null) {
      return;
    }
    await send(`/link ${code}`);
    setCode(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void send(text);
  }

  return (
    <Card className="mb-4">
      {/* Вкладки каналов: режим виден на самой вкладке (слово, не только цвет). */}
      <div role="tablist" aria-label="Каналы доступа" className="flex gap-1 border-b border-border pb-2">
        {CHANNELS.map((channel) => {
          const selected = channel === active;
          return (
            <button
              key={channel}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setActive(channel);
                setCode(null);
                setError(null);
              }}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center rounded-md px-1 text-xs font-medium ${PRESS_FEEDBACK} ${FOCUS_RING} ${
                selected ? 'bg-primary-soft text-primary' : 'text-text-muted hover:text-text'
              }`}
            >
              <span>{BOT_CHANNEL_LABELS[channel]}</span>
              <span className="text-[10px] font-normal">
                {statuses[channel] === 'live' ? 'подключён' : 'демо-режим'}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={BOT_CHANNEL_LABELS[active]} className="mt-3 space-y-3">
        {/* Режим канала: пометка честная — демо не притворяется доставкой. */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={mode === 'live' ? 'success' : 'warning'}>
            {mode === 'live' ? 'Бот подключён' : 'Демо-режим'}
          </StatusBadge>
          <StatusBadge tone={isLinked ? 'success' : 'neutral'}>
            {isLinked ? 'Канал привязан' : 'Канал не привязан'}
          </StatusBadge>
        </div>
        {mode === 'live' ? null : (
          <p className="text-sm text-text-muted">
            Токен бота не подключён: команды работают на общем бэкенде, уведомления помечаются как демо.
          </p>
        )}

        {/* Первый вход в канал: код привязки и кнопка «Привязать». */}
        {isLinked === true ? null : (
          <div className="rounded-lg border border-dashed border-border bg-surface-2/50 p-3">
            <p className="text-sm font-medium text-text">Привяжите канал</p>
            <p className="mt-0.5 text-sm text-text-muted">Код из кабинета связывает аккаунт мессенджера с вашей учётной записью.</p>
            {code === null ? (
              <Button className="mt-3" variant="secondary" loading={pending} loadingLabel="Готовим код…" onClick={() => void requestCode()}>
                Получить код
              </Button>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="font-mono text-lg font-semibold tracking-widest text-text" data-testid="link-code">
                  {code}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button loading={pending} loadingLabel="Привязываем…" onClick={() => void link()}>
                    Привязать
                  </Button>
                  <Button variant="secondary" onClick={() => setCode(null)}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Лента переписки с ботом. */}
        {messages.length === 0 ? (
          <EmptyState title="Напишите /help" description="Список команд кабинета: расписание, оценки, заявки, уведомления." icon={<IconChannels />} />
        ) : (
          <ul className="space-y-2" data-testid="channel-chat">
            {messages.map((message) => (
              <li key={message.id} className={message.from === 'me' ? 'flex justify-end' : 'flex justify-start'}>
                <p
                  className={`max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-sm ${
                    message.from === 'me'
                      ? 'bg-primary text-on-primary'
                      : 'border border-border bg-surface-2 text-text'
                  }`}
                >
                  {message.text}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div role="alert">
          {error === null ? null : (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
          )}
        </div>

        <form className="space-y-2" onSubmit={handleSubmit} noValidate>
          <TextInput
            label={`Команда для ${BOT_CHANNEL_LABELS[active]}`}
            hint="Например: /schedule или /request справка об обучении"
            value={text}
            maxLength={1000}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" loading={pending} loadingLabel="Отправляем…" disabled={text.trim() === ''}>
            Отправить
          </Button>
        </form>
      </div>
    </Card>
  );
}

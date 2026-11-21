'use client';

/**
 * Панель ассистента (клиентский остров, BRIEF v2 §5).
 *
 * Вопрос уходит на POST /api/assistant через lib/api-client: заголовок
 * X-CSRF-Token клиент добавляет сам, авторизация — только httpOnly-cookie
 * сессии. Ответ приходит текстом и показывается в живой области
 * (aria-live), поэтому скринридер зачитывает его без перемещения фокуса.
 *
 * Волна 4 «оживления» (docs/design/ui-alive-wave-4.html): лента обменов
 * вместо последнего обмена —
 * - вопрос студента появляется пузырём СИНХРОННО, до сети: отклик на
 *   отправку без ожидания ответа;
 * - на месте будущего ответа — индикатор «печатает» (TypingIndicator):
 *   он показывает реальное ожидание, а не имитацию генерации;
 * - под ответом — ссылки-источники: из каких разделов кабинета он собран
 *   (sources приходят в payload ответа);
 * - follow-up чипы и стартовые подсказки — только у последнего обмена.
 *
 * Карточка-спиннер «Думаем…» убрана: её смысл несёт индикатор в ленте,
 * а два индикатора на один ответ — шум. Живая область постоянна и
 * содержит ТОЛЬКО последний ответ: история вне неё, иначе скринридер
 * перечитывал бы весь диалог на каждый ответ.
 *
 * Чип «Верифицировать билет» — не вопрос, а действие: он ведёт в раздел
 * верификации (константа ASSISTANT_VERIFICATION_SUGGESTION в packages/core,
 * один источник для движка и интерфейса).
 */
import { Fragment, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
// Подпуть @udgu/core/assistant — лист-модуль без Prisma: в клиентский
// бандл не попадает ядро с доступом к БД.
import { ASSISTANT_VERIFICATION_SUGGESTION } from '@udgu/core/assistant';
import type { AssistantSource } from '@udgu/core';
import { ApiClientError, api } from '../../../lib/api-client';
import { PRESS_FEEDBACK } from '../../../lib/ui';
import { Button, Card, EmptyState, ErrorState, StatusBadge, TextInput } from '../../../components/ui';
import { ChatBubble, SourceLinks, TypingIndicator } from '../../../components/chat';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Чип-вопрос: цель ≥ 44 px по высоте (требование touch-targets). */
function Chip({
  label,
  onPick,
  disabled,
}: {
  label: string;
  onPick: (label: string) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(label)}
        className={`inline-flex min-h-11 items-center rounded-full border border-border bg-surface-2 px-3 text-sm text-text ${PRESS_FEEDBACK} hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
      >
        {label}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Лента обменов (волна 4)
// ---------------------------------------------------------------------------

/**
 * Обмен в ленте: вопрос студента и ответ ассистента. answer === null —
 * ответ ещё не пришёл (в ленте индикатор «печатает»), error — запрос
 * упал (в ленте ошибка с повтором внутри пузыря ассистента).
 */
export interface Exchange {
  readonly id: string;
  readonly question: string;
  readonly answer: string | null;
  readonly mode: 'deterministic' | 'llm' | null;
  readonly sources: readonly AssistantSource[];
  readonly error: string | null;
}

/** Счётчик идентификаторов обменов: уникален внутри жизни ленты. */
let exchangeSeq = 0;

/**
 * Добавляет обмен в ленту (чистая функция — проверяется без DOM):
 * вопрос виден сразу, ответ заполнится по id после сети. Лента
 * накапливается: новый вопрос добавляет обмен, а не затирает ответ.
 */
export function appendExchange(
  exchanges: readonly Exchange[],
  question: string,
): readonly Exchange[] {
  exchangeSeq += 1;
  return [
    ...exchanges,
    {
      id: `exchange-${exchangeSeq}`,
      question,
      answer: null,
      mode: null,
      sources: [],
      error: null,
    },
  ];
}

/**
 * Пузырь ассистента одного обмена: бейдж режима (только когда ответ
 * пришёл — до ответа режим неизвестен), затем ответ с источниками,
 * индикатор «печатает» или ошибка с повтором.
 */
export function AssistantBubble({
  exchange,
  onRetry,
}: {
  exchange: Exchange;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <ChatBubble
      role="assistant"
      badge={
        exchange.mode === null ? undefined : (
          <StatusBadge tone={exchange.mode === 'llm' ? 'info' : 'neutral'}>
            {exchange.mode === 'llm' ? 'ИИ-режим' : 'По данным кабинета'}
          </StatusBadge>
        )
      }
    >
      {exchange.answer !== null ? (
        <>
          {exchange.answer}
          <SourceLinks sources={exchange.sources} />
        </>
      ) : exchange.error === null ? (
        <TypingIndicator />
      ) : (
        <ErrorState message={exchange.error} onRetry={onRetry} />
      )}
    </ChatBubble>
  );
}

export function AssistantPanel({ suggestions }: { suggestions: readonly string[] }): React.JSX.Element {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<readonly Exchange[]>([]);
  const [followUps, setFollowUps] = useState<readonly string[]>([]);

  // Запрос идёт, пока в ленте есть обмен без ответа и без ошибки.
  const pending = exchanges.some((exchange) => exchange.answer === null && exchange.error === null);
  const lastExchange = exchanges.at(-1) ?? null;

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '' || pending) {
      return;
    }
    // Пузырь студента — синхронно, до сети: отклик на отправку.
    const next = appendExchange(exchanges, trimmed);
    const created = next.at(-1);
    if (created === undefined) {
      return;
    }
    setExchanges(next);
    // Follow-up чипы принадлежали прошлому ответу — новый вопрос их снимает.
    setFollowUps([]);
    try {
      const payload = await api.askAssistant(trimmed);
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === created.id
            ? {
                ...exchange,
                answer: payload.answer,
                mode: payload.mode,
                sources: payload.sources,
              }
            : exchange,
        ),
      );
      setFollowUps(payload.suggestions);
    } catch (askError) {
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === created.id
            ? {
                ...exchange,
                error:
                  askError instanceof ApiClientError
                    ? askError.message
                    : 'Не удалось получить ответ. Попробуйте снова.',
              }
            : exchange,
        ),
      );
    }
  }

  /** Чип: действие верификации ведёт в раздел, вопросы — в ассистента. */
  function pick(label: string): void {
    if (label === ASSISTANT_VERIFICATION_SUGGESTION) {
      router.push('/verification');
      return;
    }
    void ask(label);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="space-y-4">
      <Card>
        <form className="space-y-3" onSubmit={handleSubmit} noValidate>
          <TextInput
            label="Вопрос"
            hint="Например: какие у меня долги?"
            value={question}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button type="submit" loading={pending} loadingLabel="Думаем…" disabled={question.trim() === ''}>
            Спросить
          </Button>
        </form>
      </Card>

      {/* Пустое состояние и стартовые чипы — только пока лента пуста. */}
      {exchanges.length === 0 ? (
        <>
          <EmptyState
            title="Спросите про учёбу"
            description="Долги, средний балл, расписание, заявки — по вашим данным."
          />
          {suggestions.length === 0 ? null : (
            <section aria-labelledby="assistant-starters">
              <h2 id="assistant-starters" className="mb-2 text-base font-semibold text-text">
                Попробуйте спросить
              </h2>
              <ul className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <Chip key={item} label={item} onPick={pick} disabled={pending} />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}

      {/* Лента обменов: вопрос студента сразу, ответ ассистента под ним. */}
      <div className="thread space-y-4">
        {exchanges.map((exchange, index) => (
          <Fragment key={exchange.id}>
            <ChatBubble role="student">{exchange.question}</ChatBubble>
            {/* Ответ последнего обмена живёт в живой области ниже: история вне её. */}
            {index === exchanges.length - 1 ? null : (
              <AssistantBubble exchange={exchange} onRetry={() => void ask(exchange.question)} />
            )}
          </Fragment>
        ))}

        {/* Постоянная живая область: только последний ответ. Колонка флекс-
            контейнера — иначе self-start пузыря не применится и ответ
            растянется на всю ширину вместо обтекания содержимого. */}
        <div aria-live="polite" role="status" className="flex flex-col space-y-4">
          {lastExchange === null ? null : (
            <AssistantBubble exchange={lastExchange} onRetry={() => void ask(lastExchange.question)} />
          )}
        </div>
      </div>

      {/* Follow-up чипы — только под последним обменом. */}
      {followUps.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {followUps.map((item) => (
            <Chip key={item} label={item} onPick={pick} disabled={pending} />
          ))}
        </ul>
      )}
    </div>
  );
}

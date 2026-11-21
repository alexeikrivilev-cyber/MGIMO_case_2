'use client';

/**
 * Панель ассистента преподавателя (клиентский остров, BRIEF v2 §5).
 *
 * Вопрос уходит на POST /api/teacher/assistant через lib/api-client:
 * заголовок X-CSRF-Token клиент добавляет сам, авторизация — только
 * httpOnly-cookie сессии. Ответ приходит с цитатами-разделами плана и
 * показывается в живой области (aria-live), поэтому скринридер
 * зачитывает его без перемещения фокуса.
 *
 * Волна 4 «оживления» (docs/design/ui-alive-wave-4.html): та же лента
 * обменов, что и в кабинете студента (AssistantPanel) — общие примитивы
 * ChatBubble/TypingIndicator из components/chat.tsx, иначе экраны снова
 * расходились бы:
 * - вопрос преподавателя появляется пузырём СИНХРОННО, до сети;
 * - на месте будущего ответа — индикатор «печатает»; карточка-спиннер
 *   «Думаем…» убрана (два индикатора на один ответ — шум);
 * - follow-up чипы последнего ответа — под лентой, как у студента;
 * - цитаты-разделы плана остаются ВНУТРИ пузыря ассистента: для
 *   преподавателя это и есть атрибуция, ссылки-источники кабинета
 *   студента ему не нужны;
 * - живая область постоянна и содержит ТОЛЬКО последний ответ.
 */
import { Fragment, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiClientError, api, type TeacherAssistantCitation } from '../../../../lib/api-client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  StatusBadge,
  TextInput,
} from '../../../../components/ui';
import { PRESS_FEEDBACK, TEXT_LINK_SM_CLASS } from '../../../../lib/ui';
import { ChatBubble, TypingIndicator } from '../../../../components/chat';
import type { StudyPlanListItem } from '@udgu/core';

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
 * Обмен в ленте: вопрос преподавателя и ответ ассистента по его плану.
 * answer === null — ответ ещё не пришёл (индикатор «печатает»), error —
 * запрос упал (ошибка с повтором внутри пузыря ассистента).
 */
export interface Exchange {
  readonly id: string;
  readonly question: string;
  readonly answer: string | null;
  readonly mode: 'deterministic' | 'llm' | null;
  readonly citations: readonly TeacherAssistantCitation[];
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
      citations: [],
      error: null,
    },
  ];
}

/**
 * Пузырь ассистента одного обмена: бейдж режима (только когда ответ
 * пришёл), ответ с цитатами-разделами плана, индикатор «печатает» или
 * ошибка с повтором.
 */
export function TeacherAssistantBubble({
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
            {exchange.mode === 'llm' ? 'ИИ-режим' : 'По плану'}
          </StatusBadge>
        )
      }
    >
      {exchange.answer !== null ? (
        <>
          {exchange.answer}
          {exchange.citations.length === 0 ? null : (
            <ul className="mt-3 space-y-1.5" data-testid="assistant-citations">
              {exchange.citations.map((citation) => (
                <li key={citation.section} className="text-xs text-text-muted">
                  Раздел плана: {citation.section}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : exchange.error === null ? (
        <TypingIndicator />
      ) : (
        <ErrorState message={exchange.error} onRetry={onRetry} />
      )}
    </ChatBubble>
  );
}

export function TeacherAssistantPanel({
  plans,
  suggestions,
}: {
  plans: readonly StudyPlanListItem[];
  suggestions: readonly string[];
}): React.JSX.Element {
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? '');
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<readonly Exchange[]>([]);
  // Follow-up чипы последнего ответа (payload.suggestions): диалог
  // продолжается без набора текста — как в кабинете студента.
  const [followUps, setFollowUps] = useState<readonly string[]>([]);

  // Запрос идёт, пока в ленте есть обмен без ответа и без ошибки.
  const pending = exchanges.some((exchange) => exchange.answer === null && exchange.error === null);
  const lastExchange = exchanges.at(-1) ?? null;

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '' || pending) {
      return;
    }
    // Пузырь преподавателя — синхронно, до сети: отклик на отправку.
    const next = appendExchange(exchanges, trimmed);
    const created = next.at(-1);
    if (created === undefined) {
      return;
    }
    setExchanges(next);
    // Follow-up чипы принадлежали прошлому ответу — новый вопрос их снимает.
    setFollowUps([]);
    try {
      const payload = await api.askTeacherAssistant(trimmed, planId === '' ? undefined : planId);
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === created.id
            ? {
                ...exchange,
                answer: payload.answer,
                mode: payload.mode,
                citations: payload.citations,
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

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void ask(question);
  }

  if (plans.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Планов пока нет"
          description="Ассистент отвечает по разделам загруженного учебного плана."
        />
        <LinkButton href="/teacher/plans" variant="primary">
          Загрузить план
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <form className="space-y-3" onSubmit={handleSubmit} noValidate>
          {plans.length > 1 ? (
            <div className="space-y-1.5">
              <label htmlFor="assistant-plan" className="block text-sm font-medium text-text">
                План
              </label>
              <select
                id="assistant-plan"
                value={planId}
                disabled={pending}
                onChange={(event) => setPlanId(event.target.value)}
                className="block w-full min-h-11 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <TextInput
            label="Вопрос"
            hint="Например: какие темы проходят в 3 модуле?"
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
          <EmptyState title="Спросите по плану" description="Темы модулей, лабораторные, контрольные точки." />
          {suggestions.length === 0 ? null : (
            <section aria-labelledby="teacher-assistant-starters">
              <h2 id="teacher-assistant-starters" className="mb-2 text-base font-semibold text-text">
                Попробуйте спросить
              </h2>
              <ul className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <Chip key={item} label={item} onPick={(label) => void ask(label)} disabled={pending} />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}

      {/* Лента обменов: вопрос преподавателя сразу, ответ ассистента под ним. */}
      <div className="thread space-y-4">
        {exchanges.map((exchange, index) => (
          <Fragment key={exchange.id}>
            <ChatBubble role="student">{exchange.question}</ChatBubble>
            {/* Ответ последнего обмена живёт в живой области ниже: история вне её. */}
            {index === exchanges.length - 1 ? null : (
              <TeacherAssistantBubble exchange={exchange} onRetry={() => void ask(exchange.question)} />
            )}
          </Fragment>
        ))}

        {/* Постоянная живая область: только последний ответ. Колонка флекс-
            контейнера — иначе self-start пузыря не применится и ответ
            растянется на всю ширину вместо обтекания содержимого. */}
        <div aria-live="polite" role="status" className="flex flex-col space-y-4">
          {lastExchange === null ? null : (
            <TeacherAssistantBubble exchange={lastExchange} onRetry={() => void ask(lastExchange.question)} />
          )}
        </div>
      </div>

      {/* Follow-up чипы — только под последним обменом (как у студента). */}
      {followUps.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {followUps.map((item) => (
            <Chip key={item} label={item} onPick={(label) => void ask(label)} disabled={pending} />
          ))}
        </ul>
      )}

      <p className="text-xs text-text-muted">
        Ответы строятся по вашим планам.{' '}
        <Link href="/teacher/plans" className={TEXT_LINK_SM_CLASS}>
          Загрузить ещё план
        </Link>
      </p>
    </div>
  );
}

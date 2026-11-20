'use client';

/**
 * Панель ассистента (клиентский остров, BRIEF v2 §5).
 *
 * Вопрос уходит на POST /api/assistant через lib/api-client: заголовок
 * X-CSRF-Token клиент добавляет сам, авторизация — только httpOnly-cookie
 * сессии. Ответ приходит текстом и показывается в живой области
 * (aria-live), поэтому скринридер зачитывает его без перемещения фокуса.
 *
 * Состояния: пустое (стартовые чипы), «думает» (кнопка в loading +
 * строка статуса), ответ, ошибка. Подсказки из ответа становятся чипами
 * follow-up — диалог продолжается без набора текста.
 *
 * Чип «Верифицировать билет» — не вопрос, а действие: он ведёт в раздел
 * верификации (константа ASSISTANT_VERIFICATION_SUGGESTION в packages/core,
 * один источник для движка и интерфейса).
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
// Подпуть @udgu/core/assistant — лист-модуль без Prisma: в клиентский
// бандл не попадает ядро с доступом к БД.
import { ASSISTANT_VERIFICATION_SUGGESTION } from '@udgu/core/assistant';
import { ApiClientError, api } from '../../../lib/api-client';
import { PRESS_FEEDBACK } from '../../../lib/ui';
import { Button, Card, EmptyState, ErrorState, Spinner, StatusBadge, TextInput } from '../../../components/ui';

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

export function AssistantPanel({ suggestions }: { suggestions: readonly string[] }): React.JSX.Element {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [mode, setMode] = useState<'deterministic' | 'llm' | null>(null);
  const [followUps, setFollowUps] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '' || pending) {
      return;
    }
    setPending(true);
    setError(null);
    setAsked(trimmed);
    try {
      const payload = await api.askAssistant(trimmed);
      setAnswer(payload.answer);
      setMode(payload.mode);
      setFollowUps(payload.suggestions);
    } catch (askError) {
      setAnswer(null);
      setMode(null);
      setFollowUps([]);
      setError(
        askError instanceof ApiClientError
          ? askError.message
          : 'Не удалось получить ответ. Попробуйте снова.',
      );
    } finally {
      setPending(false);
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

  const hasAnswer = answer !== null;

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

      {/* Пустое состояние: одна строка + готовые вопросы (BRIEF v4). */}
      {hasAnswer === true || pending === true ? null : (
        <EmptyState
          title="Спросите про учёбу"
          description="Долги, средний балл, расписание, заявки — по вашим данным."
        />
      )}

      {pending === true ? (
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner label="Думаем…" />
            Думаем…
          </div>
        </Card>
      ) : null}

      {/* Ответ — живая область: меняется без перезагрузки страницы. */}
      <div aria-live="polite" role="status" className="space-y-4">
        {answer === null ? null : (
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm text-text-muted">{asked}</p>
              <StatusBadge tone={mode === 'llm' ? 'info' : 'neutral'}>
                {mode === 'llm' ? 'ИИ-режим' : 'По данным кабинета'}
              </StatusBadge>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-text">{answer}</p>
          </Card>
        )}

        {error === null ? null : <ErrorState message={error} onRetry={() => void ask(asked ?? '')} />}

        {followUps.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2">
            {followUps.map((item) => (
              <Chip key={item} label={item} onPick={pick} disabled={pending} />
            ))}
          </ul>
        )}
      </div>

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
    </div>
  );
}

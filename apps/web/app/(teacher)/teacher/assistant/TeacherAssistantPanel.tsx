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
 * Состояния: пустое (нет планов — ведёт в «Мои планы»), «думает»,
 * ответ с цитатами, ошибка. Чипы примеров вопросов задают формулировки:
 * «Какие темы проходят в 3 модуле?», «Что по лабораторным?»,
 * «Где контрольные точки?».
 */
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiClientError, api } from '../../../../lib/api-client';
import { Button, Card, EmptyState, ErrorState, LinkButton, Spinner, StatusBadge, TextInput } from '../../../../components/ui';
import { PRESS_FEEDBACK, TEXT_LINK_SM_CLASS } from '../../../../lib/ui';
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

export function TeacherAssistantPanel({
  plans,
  suggestions,
}: {
  plans: readonly StudyPlanListItem[];
  suggestions: readonly string[];
}): React.JSX.Element {
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? '');
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<readonly { section: string; score: number }[]>([]);
  const [mode, setMode] = useState<'deterministic' | 'llm' | null>(null);
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
      const payload = await api.askTeacherAssistant(trimmed, planId === '' ? undefined : planId);
      setAnswer(payload.answer);
      setCitations(payload.citations);
      setMode(payload.mode);
    } catch (askError) {
      setAnswer(null);
      setCitations([]);
      setMode(null);
      setError(
        askError instanceof ApiClientError
          ? askError.message
          : 'Не удалось получить ответ. Попробуйте снова.',
      );
    } finally {
      setPending(false);
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

  const hasAnswer = answer !== null;

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

      {/* Пустое состояние: одна строка + готовые вопросы (BRIEF v4). */}
      {hasAnswer === true || pending === true ? null : (
        <EmptyState title="Спросите по плану" description="Темы модулей, лабораторные, контрольные точки." />
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
                {mode === 'llm' ? 'ИИ-режим' : 'По плану'}
              </StatusBadge>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-text">{answer}</p>
            {citations.length === 0 ? null : (
              <ul className="mt-3 space-y-1.5" data-testid="assistant-citations">
                {citations.map((citation) => (
                  <li key={citation.section} className="text-xs text-text-muted">
                    Раздел плана: {citation.section}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {error === null ? null : <ErrorState message={error} onRetry={() => void ask(asked ?? '')} />}

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
      </div>

      <p className="text-xs text-text-muted">
        Ответы строятся по вашим планам.{' '}
        <Link href="/teacher/plans" className={TEXT_LINK_SM_CLASS}>
          Загрузить ещё план
        </Link>
      </p>
    </div>
  );
}

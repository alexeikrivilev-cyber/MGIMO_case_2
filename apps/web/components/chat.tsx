/**
 * Примитивы чата ассистента (волна 4 «оживления»,
 * docs/design/ui-alive-wave-4.html).
 *
 * Один набор пузырей на оба чата кабинета — студента (AssistantPanel)
 * и преподавателя (TeacherAssistantPanel): расхождение экранов
 * начинается ровно здесь, поэтому лента, индикатор «печатает» и
 * ссылки-источники живут в одном модуле, а не копируются по панелям.
 *
 * Правила (артефакт волны 4):
 * - пузырь студента справа (bg-primary-soft + рамка primary), ассистента
 *   слева (bg-surface + рамка border) — только токены волны 1;
 * - max-w-[85%] + wrap-anywhere + whitespace-pre-line: длинный план с
 *   окнами переносится, 360 px держит;
 * - индикатор «печатает» — три точки (.typing-dot, globals.css) и sr-only
 *   текст; посимвольной печати нет: ответ приходит целиком;
 * - ссылки-источники: Hit ≥ 24 px (WCAG 2.5.8), PRESS_FEEDBACK и
 *   FOCUS_RING — как у любой другой интерактивной области кабинета.
 *
 * Модуль без 'use client' и без состояния: чистый рендер, поэтому он
 * работает и в серверной разметке, и внутри клиентских островов.
 */
import type { ReactNode } from 'react';
import type { AssistantSource } from '@udgu/core';
import { FOCUS_RING, PRESS_FEEDBACK } from '../lib/ui';

/** Пузырь ленты: вопрос студента или ответ ассистента (badge — над содержимым). */
export function ChatBubble({
  role,
  children,
  badge,
}: {
  role: 'student' | 'assistant';
  children: ReactNode;
  badge?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={
        role === 'student'
          ? 'self-end max-w-[85%] rounded-xl rounded-br-md border border-primary bg-primary-soft px-3 py-2.5 text-sm text-text wrap-anywhere whitespace-pre-line'
          : 'self-start max-w-[85%] rounded-xl rounded-bl-md border border-border bg-surface px-3 py-2.5 text-sm text-text wrap-anywhere whitespace-pre-line'
      }
    >
      {badge === undefined ? null : (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{badge}</div>
      )}
      {children}
    </div>
  );
}

/**
 * Индикатор «печатает»: три точки пульсируют по очереди (globals.css),
 * смысл несёт sr-only текст. Индикатор показывает РЕАЛЬНОЕ ожидание
 * ответа — не имитацию генерации.
 */
export function TypingIndicator(): React.JSX.Element {
  return (
    <span role="status" className="inline-flex items-center gap-1 py-0.5">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="sr-only">Ассистент печатает…</span>
    </span>
  );
}

/**
 * Ссылки-источники под ответом: из каких разделов кабинета он собран.
 * Пустой список не рендерится — у HELP, UNKNOWN и заглушки гейта
 * верификации источников нет (врать нечем).
 */
export function SourceLinks({
  sources,
}: {
  sources: readonly AssistantSource[];
}): React.JSX.Element | null {
  if (sources.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-text-muted">Источники:</span>
      {sources.map((source) => (
        <a
          key={source.href}
          href={source.href}
          className={`inline-flex min-h-6 items-center rounded-full border border-border bg-surface-2 px-2.5 text-xs font-medium text-primary underline decoration-dotted ${PRESS_FEEDBACK} ${FOCUS_RING}`}
        >
          {source.label}
        </a>
      ))}
    </div>
  );
}

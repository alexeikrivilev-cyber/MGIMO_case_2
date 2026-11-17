/**
 * Заголовок страницы кабинета: заголовок + подзаголовок + необязательное
 * действие справа. Семантический h1 — на каждом экране ровно один.
 */
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle === undefined ? null : <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </header>
  );
}

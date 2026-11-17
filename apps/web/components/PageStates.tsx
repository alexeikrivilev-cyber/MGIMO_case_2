/**
 * Состояния страницы кабинета: результат загрузки (LoadResult) →
 * содержимое или понятное состояние ошибки.
 *
 * Требование P1.4b: у каждой ошибки — человеческий текст и что делать
 * (role=alert + aria-live), без «нет данных» без объяснения. Гейт
 * верификации показывается карточкой с призывом верифицировать
 * студбилет — успеваемость до сверки закрыта (BRIEF v2).
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button, Card, ErrorState } from './ui';
import type { LoadResult, PageError } from '../lib/page-data';

/** Иконка-замок для закрытого раздела (декоративная, текст рядом). */
function LockIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

/**
 * Карточка гейта верификации: раздел закрыт до сверки студбилета.
 * Используется и как состояние ошибки страницы успеваемости, и как
 * заглушка на дашборде — один текст и одно действие на все экраны.
 */
export function VerificationGateCard(): React.JSX.Element {
  return (
    <Card className="border-primary/40 bg-primary-soft/40" data-testid="verification-gate">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-primary">
          <LockIcon />
        </span>
        <div>
          <h2 className="text-base font-semibold text-text">Раздел открывается после верификации</h2>
          <p className="mt-1 text-sm text-text-muted">
            Успеваемость и переписка с преподавателями доступны только после проверки студенческого
            билета: так кабинет защищает ваши оценки от чужого доступа. Загрузите фото билета —
            решение принимает сотрудник деканата.
          </p>
          <div className="mt-4">
            <Link href="/verification">
              <Button variant="primary">Верифицировать студенческий билет</Button>
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PageErrorView({ error }: { error: PageError }): React.JSX.Element {
  switch (error.kind) {
    case 'unauthenticated':
      return (
        <Card>
          <h2 className="text-base font-semibold text-text">Сессия истекла</h2>
          <p className="mt-1 text-sm text-text-muted">{error.message}</p>
          <div className="mt-4">
            <Link href="/login">
              <Button variant="primary">Войти в кабинет</Button>
            </Link>
          </div>
        </Card>
      );

    case 'verification-required':
      return <VerificationGateCard />;

    case 'forbidden':
      return (
        <Card>
          <h2 className="text-base font-semibold text-text">Раздел недоступен</h2>
          <p className="mt-1 text-sm text-text-muted">{error.message}</p>
          <div className="mt-4">
            <Link href="/">
              <Button variant="secondary">На главный экран</Button>
            </Link>
          </div>
        </Card>
      );

    case 'not-found':
      return (
        <Card>
          <h2 className="text-base font-semibold text-text">Не найдено</h2>
          <p className="mt-1 text-sm text-text-muted">{error.message}</p>
          <div className="mt-4">
            <Link href="/">
              <Button variant="secondary">На главный экран</Button>
            </Link>
          </div>
        </Card>
      );

    case 'error':
      return (
        <div className="space-y-4">
          <ErrorState message={error.message} />
          <Link href="/">
            <Button variant="secondary">На главный экран</Button>
          </Link>
        </div>
      );
  }
}

/**
 * Обёртка страницы: при успехе отдаёт данные в render-функцию, при
 * ошибке — состояние ошибки. Один компонент на все экраны — текст и
 * действия единообразны.
 */
export function PageResult<T>({
  result,
  children,
}: {
  result: LoadResult<T>;
  children: (value: T) => ReactNode;
}): React.JSX.Element {
  if (result.ok) {
    return <>{children(result.value)}</>;
  }
  return <PageErrorView error={result.error} />;
}

/** Заголовок секции внутри страницы (семантический h2). */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-text">{children}</h2>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

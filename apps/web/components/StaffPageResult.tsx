import type { ReactNode } from 'react';
import { Card, ErrorState, LinkButton } from './ui';
import type { LoadResult, PageError } from '../lib/page-data';

/**
 * Состояния страниц кабинета сотрудника деканата (route group (staff)).
 *
 * Отдельная обёртка (а не общий PageResult) из-за путей «куда идти
 * дальше»: у студента это главный экран кабинета, у сотрудника — сводка
 * /staff, а преподаватель (STAFF без факультета в учётной записи) в
 * очереди деканата не попадает вовсе (requireStaffScope → STAFF_ONLY):
 * ему показываем объяснение и ведём в его раздел — переписку. Иначе
 * ссылка «на главный экран» вернула бы его на /staff, и получался бы
 * замкнутый круг.
 */
function StaffErrorView({ error }: { error: PageError }): React.JSX.Element {
  switch (error.kind) {
    case 'unauthenticated':
      return (
        <Card>
          <h2 className="text-base font-semibold text-text">Сессия истекла</h2>
          <p className="mt-1 text-sm text-text-muted">{error.message}</p>
          <div className="mt-4">
            <LinkButton href="/login" variant="primary">
              Войти в кабинет
            </LinkButton>
          </div>
        </Card>
      );

    case 'forbidden':
      return (
        <Card data-testid="staff-forbidden">
          <h2 className="text-base font-semibold text-text">Раздел недоступен</h2>
          <p className="mt-1 text-sm text-text-muted">
            Кабинет деканата доступен сотрудникам деканата и администратору.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/messages" variant="primary">
              Переписка со студентами
            </LinkButton>
            <LinkButton href="/" variant="secondary">
              Личный кабинет
            </LinkButton>
          </div>
        </Card>
      );

    case 'not-found':
      return (
        <Card>
          <h2 className="text-base font-semibold text-text">Не найдено</h2>
          <p className="mt-1 text-sm text-text-muted">{error.message}</p>
          <div className="mt-4">
            <LinkButton href="/staff" variant="secondary">
              К сводке кабинета
            </LinkButton>
          </div>
        </Card>
      );

    case 'error':
      return (
        <div className="space-y-4">
          <ErrorState message={error.message} />
          <LinkButton href="/staff" variant="secondary">
            К сводке кабинета
          </LinkButton>
        </div>
      );

    default:
      return (
        <Card>
          <h2 className="text-base font-semibold text-text">Раздел недоступен</h2>
          <p className="mt-1 text-sm text-text-muted">{error.message}</p>
          <div className="mt-4">
            <LinkButton href="/messages" variant="secondary">
              Переписка со студентами
            </LinkButton>
          </div>
        </Card>
      );
  }
}

/**
 * Обёртка страницы кабинета сотрудника: при успехе отдаёт данные в
 * render-функцию, при ошибке — состояние, понятное сотруднику.
 */
export function StaffPageResult<T>({
  result,
  children,
}: {
  result: LoadResult<T>;
  children: (value: T) => ReactNode;
}): React.JSX.Element {
  if (result.ok) {
    return <>{children(result.value)}</>;
  }
  return <StaffErrorView error={result.error} />;
}

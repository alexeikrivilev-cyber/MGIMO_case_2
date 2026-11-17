/**
 * Скелетон страницы кабинета: показывается, пока сервер досчитывает
 * данные (streaming SSR) или идёт переход по ссылке. Форма повторяет
 * каркас экранов: заголовок + блоки — чтобы не было «прыжка» вёрстки.
 */
import { Skeleton } from './ui';
import { PageHeader } from './PageHeader';

export function PageSkeleton({ blocks = 3 }: { blocks?: number }): React.JSX.Element {
  return (
    <div aria-busy="true">
      <PageHeader title="Загрузка…" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" label="Загружаем данные…" />
        {Array.from({ length: blocks }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Card, LinkButton } from './ui';
import { ConceptMark } from './ConceptMark';

/**
 * Карточка «страница не найдена» — общая для всех route groups кабинета
 * ((cabinet), (staff), (messages)).
 *
 * Требование кейса к ошибкам: не «404» без объяснения, а что случилось
 * и куда идти дальше. Текст и действие одинаковы во всех разделах —
 * поэтому компонент один, а не три копии.
 */
export function NotFoundCard({
  homeHref,
  homeLabel,
  title = 'Страница не найдена',
  description = 'Возможно, ссылка устарела или запись удалена. Вернитесь на главный экран — оттуда есть путь в любой раздел кабинета.',
}: {
  /** Куда ведёт кнопка: студенту — в кабинет, сотруднику — в /staff. */
  readonly homeHref: string;
  readonly homeLabel: string;
  readonly title?: string;
  readonly description?: ReactNode;
}): React.JSX.Element {
  return (
    <Card className="mt-6 text-center">
      <ConceptMark className="mx-auto h-10 w-10 text-primary" />
      <h1 className="mt-3 text-lg font-semibold text-text">{title}</h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">{description}</p>
      <div className="mt-4 flex justify-center">
        <LinkButton href={homeHref} variant="primary">
          {homeLabel}
        </LinkButton>
      </div>
    </Card>
  );
}

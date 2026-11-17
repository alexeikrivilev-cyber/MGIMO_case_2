import { NotFoundCard } from '../../components/NotFoundCard';

/**
 * 404 внутри раздела «Переписка»: например, диалог удалён или ссылка
 * устарела. Ведём в список диалогов — оттуда видно всю переписку.
 */
export default function MessagesNotFound(): React.JSX.Element {
  return (
    <NotFoundCard
      homeHref="/messages"
      homeLabel="К списку диалогов"
      description="Диалог удалён или ссылка устарела."
    />
  );
}

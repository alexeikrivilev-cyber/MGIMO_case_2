import { NotFoundCard } from '../../components/NotFoundCard';

/**
 * 404 внутри кабинета: например, преподаватель по неизвестному
 * идентификатору. Объясняем, что случилось, и даём путь назад —
 * требование кейса к пустым состояниям и ошибкам.
 */
export default function CabinetNotFound(): React.JSX.Element {
  return <NotFoundCard homeHref="/" homeLabel="На главный экран" />;
}

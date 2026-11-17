import { NotFoundCard } from '../../components/NotFoundCard';

/**
 * 404 внутри кабинета сотрудника: устаревшая ссылка на заявку или пару.
 * Ведём в сводку кабинета — оттуда есть путь во все разделы.
 */
export default function StaffNotFound(): React.JSX.Element {
  return (
    <NotFoundCard
      homeHref="/staff"
      homeLabel="К сводке кабинета"
      description="Возможно, ссылка устарела или запись удалена. Вернитесь к сводке кабинета — оттуда есть путь во все разделы."
    />
  );
}

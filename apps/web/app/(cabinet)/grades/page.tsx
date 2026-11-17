import { GradesScreen } from './grades-screen';

/**
 * /grades — успеваемость студента. Фильтр семестра приходит query
 * (?semester=N), переключатель — серверные ссылки. Раздел закрыт гейтом
 * верификации: до сверки студбилета страница показывает заглушку с
 * призывом верифицировать (проверка на сервере, packages/core).
 */
export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <GradesScreen semester={params.semester} />;
}

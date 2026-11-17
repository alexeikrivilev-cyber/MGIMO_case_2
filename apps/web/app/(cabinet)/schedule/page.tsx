import { ScheduleScreen } from './schedule-screen';

/**
 * /schedule — расписание своей группы. Режим («Сегодня» / «Неделя») и
 * смещение недели приходят query-строкой: экран перерисовывается на
 * сервере, поэтому оба состояния доступны и по прямой ссылке.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; offset?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <ScheduleScreen view={params.view} offset={params.offset} />;
}

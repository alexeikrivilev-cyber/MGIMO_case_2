import { StaffScheduleScreen } from './schedule-screen';

/**
 * /staff/schedule — расписание групп института за период (по умолчанию
 * две недели от сегодня). Query ?from&to (YYYY-MM-DD) задаёт период:
 * сотрудник смотрит и прошлую, и будущую неделю.
 */
export default async function StaffSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <StaffScheduleScreen from={params.from} to={params.to} />;
}

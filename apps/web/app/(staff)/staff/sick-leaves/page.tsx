import { StaffSickLeavesScreen } from './sick-leaves-screen';

/**
 * /staff/sick-leaves — кто из студентов института болеет.
 * Query ?onlyActive=true — только те, чей период покрывает сегодня.
 */
export default async function StaffSickLeavesPage({
  searchParams,
}: {
  searchParams: Promise<{ onlyActive?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <StaffSickLeavesScreen onlyActive={params.onlyActive === 'true'} />;
}

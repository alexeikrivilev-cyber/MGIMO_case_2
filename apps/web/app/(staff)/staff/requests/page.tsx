import { StaffRequestsScreen } from './requests-screen';

/**
 * /staff/requests — очередь заявок и справок студентов института.
 * Query ?status=NEW|IN_PROGRESS|READY|REJECTED фильтрует очередь;
 * состояние в адресе — работает и без JS.
 */
export default async function StaffRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <StaffRequestsScreen status={params.status} />;
}

import { StaffVerificationsScreen } from './verifications-screen';

/**
 * /staff/verifications — очередь верификаций студбилетов института.
 * Query ?status=PENDING|VERIFIED|REJECTED фильтрует очередь.
 */
export default async function StaffVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <StaffVerificationsScreen status={params.status} />;
}

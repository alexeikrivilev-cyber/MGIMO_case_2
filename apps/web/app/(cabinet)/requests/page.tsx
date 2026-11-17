import { RequestsScreen } from './requests-screen';

/**
 * /requests — заявки и справки студента. Query ?new=1 открывает форму
 * новой заявки (состояние в адресе — работает и без JS).
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <RequestsScreen formOpen={params.new === '1'} />;
}

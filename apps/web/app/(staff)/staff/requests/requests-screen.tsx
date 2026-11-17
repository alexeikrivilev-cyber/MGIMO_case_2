/**
 * Экран «Заявки» кабинета сотрудника деканата: очередь заявок и справок
 * студентов своего института (ARCHITECTURE §4).
 *
 * Каждая карточка — студент (ФИО, группа), тип заявки, данные формы,
 * дата подачи и решение сотрудника: новый статус + комментарий студенту.
 * Форма решения живёт в раскрывающемся блоке: очередь читаема, когда в
 * ней двадцать заявок, а форма открывается ровно у той, что обрабатывают.
 *
 * Фильтр по статусу — ссылками с query (SegmentedLinks): состояние в
 * адресе, поэтому «десять новых» можно переслать коллеге ссылкой.
 */
import { cookies } from 'next/headers';
import { EmptyState, SegmentedLinks } from '../../../../components/ui';
import { PageHeader } from '../../../../components/PageHeader';
import { StaffPageResult } from '../../../../components/StaffPageResult';
import {
  loadStaffRequestsPageData,
  type LoadResult,
  type StaffRequestsPageData,
  type StaffRequestStatusFilter,
} from '../../../../lib/page-data';
import { StaffRequestCard } from './StaffRequestCard';

/** Фильтр очереди: варианты статуса и подписи. */
const FILTERS: readonly { status: StaffRequestStatusFilter | null; label: string }[] = [
  { status: null, label: 'Все' },
  { status: 'NEW', label: 'Новые' },
  { status: 'IN_PROGRESS', label: 'В работе' },
  { status: 'READY', label: 'Готовы' },
  { status: 'REJECTED', label: 'Отказы' },
];

export function StaffRequestsView({
  result,
}: {
  result: LoadResult<StaffRequestsPageData>;
}): React.JSX.Element {
  return (
    <StaffPageResult result={result}>
      {(data) => {
        const activeFilter = data.status ?? 'ALL';
        return (
          <>
            <PageHeader
              title="Заявки и справки"
              subtitle="Очередь заявок студентов института"
              action={
                <span className="text-sm text-text-muted">
                  {data.requests.length === 0 ? '0 заявок' : `${data.requests.length} в выборке`}
                </span>
              }
            />

            <div className="mb-4">
              <SegmentedLinks
                label="Фильтр по статусу заявки"
                className="flex-wrap"
                items={FILTERS.map((filter) => ({
                  href: filter.status === null ? '/staff/requests' : `/staff/requests?status=${filter.status}`,
                  label: filter.label,
                  active: (filter.status ?? 'ALL') === activeFilter,
                }))}
              />
            </div>

            {data.requests.length === 0 ? (
              <EmptyState
                title={activeFilter === 'ALL' ? 'В очереди нет заявок' : 'В этом статусе заявок нет'}
                action={
                  activeFilter === 'ALL' ? undefined : (
                    <SegmentedLinks
                      label="Показать все заявки"
                      items={[{ href: '/staff/requests', label: 'Показать все', active: false }]}
                    />
                  )
                }
              />
            ) : (
              <ul className="space-y-3">
                {data.requests.map((request) => (
                  <li key={request.id}>
                    <StaffRequestCard request={request} />
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      }}
    </StaffPageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function StaffRequestsScreen({ status }: { status: string | undefined }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadStaffRequestsPageData(cookieStore.toString(), status);
  return <StaffRequestsView result={result} />;
}

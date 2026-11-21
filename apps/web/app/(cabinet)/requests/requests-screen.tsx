/**
 * Экран «Заявки»: список своих заявок и справок со статусами и меткой
 * «чей ход» (решение Council), форма новой заявки и отмена своей заявки
 * в статусе NEW.
 *
 * Состояние «форма открыта» живёт в адресе (/requests?new=1): список
 * рендерит сервер, форма — клиентский остров, после отправки остров
 * уводит на /requests и страница перерисовывается с новой заявкой.
 * Мутации идут только через /api/* (lib/api-client).
 */
import { cookies } from 'next/headers';
import { Card, EmptyState, LinkButton, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { RequestTimeline } from '../../../components/RequestTimeline';
import { formatMoment } from '../../../components/format';
import { requestFieldLabel, requestStatusTone, requestTurnLabel } from '../../../components/labels';
import { IconRequests } from '../../../components/icons';
import { loadRequestsPageData, type LoadResult, type RequestsPageData } from '../../../lib/page-data';
import { RequestForm } from './RequestForm';
import { CancelRequestButton } from './CancelRequestButton';

export function RequestsView({
  result,
  formOpen,
}: {
  result: LoadResult<RequestsPageData>;
  formOpen: boolean;
}): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader
            title="Заявки"
            subtitle="Справки и заявления в деканат"
            action={
              <LinkButton href={formOpen ? '/requests' : '/requests?new=1'}>
                {formOpen ? 'Закрыть форму' : 'Новая заявка'}
              </LinkButton>
            }
          />

          {formOpen === true ? (
            <div className="mb-4">
              <RequestForm />
            </div>
          ) : null}

          {data.requests.length === 0 ? (
            <EmptyState
              title="Заявок нет"
              icon={<IconRequests />}
              action={
                <LinkButton href="/requests?new=1">
                  Подать заявку
                </LinkButton>
              }
            />
          ) : (
            <ul className="space-y-3">
              {data.requests.map((request) => {
                const turn = requestTurnLabel(request.status);
                return (
                  <li key={request.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="min-w-0 flex-1 text-base font-semibold text-text">{request.typeLabel}</h2>
                        <StatusBadge tone={requestStatusTone(request.status)}>{request.statusLabel}</StatusBadge>
                        <StatusBadge tone={turn === 'Ваш ход' ? 'warning' : 'neutral'}>{turn}</StatusBadge>
                      </div>

                      {/* Шаги продвижения заявки (волна 2): бейджи остаются,
                          таймлайн отвечает «двигалась ли заявка». У отказа
                          компонент не рендерит ничего. */}
                      <RequestTimeline status={request.status} />

                      <dl className="mt-3 space-y-1.5">
                        {Object.entries(request.formData).map(([key, value]) => (
                          <div key={key} className="flex gap-2 text-sm">
                            <dt className="shrink-0 text-text-muted">{requestFieldLabel(key)}:</dt>
                            <dd className="min-w-0 text-text">{value}</dd>
                          </div>
                        ))}
                      </dl>

                      {request.staffComment === null ? null : (
                        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text">
                          <span className="font-medium">Комментарий сотрудника: </span>
                          {request.staffComment}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <p className="text-xs text-text-muted">Создана {formatMoment(new Date(request.createdAt))}</p>
                        {request.status === 'NEW' ? <CancelRequestButton requestId={request.id} /> : null}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function RequestsScreen({ formOpen }: { formOpen: boolean }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadRequestsPageData(cookieStore.toString());
  return <RequestsView result={result} formOpen={formOpen} />;
}

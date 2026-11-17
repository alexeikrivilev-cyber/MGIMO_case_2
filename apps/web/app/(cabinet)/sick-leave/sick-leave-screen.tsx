/**
 * Экран «Я болею»: отметка о болезни на период + история отметок.
 *
 * Статус видят преподаватели и деканат (синтетический реестр BRIEF v2):
 * отражается в учёте посещаемости, поэтому отметка действует сразу.
 * Активная отметка (период ещё не закончился) выделена бейджем
 * «Действует» — формой и словом, не только цветом.
 */
import { cookies } from 'next/headers';
import { Card, EmptyState, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { formatDate, formatMoment } from '../../../components/format';
import { loadSickLeavePageData, type LoadResult, type SickLeavePageData } from '../../../lib/page-data';
import { SickLeaveForm } from './SickLeaveForm';
import type { MySickLeave } from '@udgu/core';

/** Отметка ещё действует: период не закончился (даты — полночь UTC). */
function isActive(leave: MySickLeave, now: Date): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return leave.dateFrom.getTime() <= today && leave.dateTo.getTime() >= today;
}

function SickLeaveCard({ leave, active }: { leave: MySickLeave; active: boolean }): React.JSX.Element {
  return (
    <Card className={active === true ? 'border-primary/50 bg-primary-soft/30' : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-text">
          {formatDate(leave.dateFrom)} — {formatDate(leave.dateTo)}
        </h3>
        {active === true ? <StatusBadge tone="info">Действует</StatusBadge> : <StatusBadge tone="neutral">Завершена</StatusBadge>}
        {leave.hasAttachment === true ? <StatusBadge tone="neutral">Справка прикреплена</StatusBadge> : null}
      </div>
      {leave.reason === null ? null : (
        <p className="mt-1.5 text-sm text-text-muted">Причина: {leave.reason}</p>
      )}
      <p className="mt-1 text-xs text-text-muted">Отправлена {formatMoment(new Date(leave.createdAt))}</p>
    </Card>
  );
}

export function SickLeaveView({ result }: { result: LoadResult<SickLeavePageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        const now = new Date();
        return (
          <>
            <PageHeader title="Я болею" subtitle="Отметка о болезни на период" />

            <Card className="mb-4">
              <h2 className="text-base font-semibold text-text">Кто видит статус</h2>
              <p className="mt-1 text-sm text-text-muted">
                Отметку видят преподаватели ваших пар и сотрудники деканата: статус учитывается в
                посещаемости, поэтому отмечайте болезнь с первого дня. Если прикрепить фото справки,
                его тоже увидит только проверяющий сотрудник — файл лежит в приватном хранилище.
              </p>
            </Card>

            {data.sickNow === true ? (
              <Card className="mb-4 border-info/40" data-testid="sick-now">
                <p className="text-sm font-medium text-text">
                  Сейчас вы отмечены как болеющий — преподаватели и деканат видят этот статус.
                </p>
              </Card>
            ) : null}

            <div className="mb-4">
              <SickLeaveForm />
            </div>

            <section aria-labelledby="sick-history">
              <h2 id="sick-history" className="mb-2 text-base font-semibold text-text">
                История отметок
              </h2>
              {data.items.length === 0 ? (
                <EmptyState
                  title="Отметок пока нет"
                  description="Когда вы заболеете, отметьте болезнь выше: период, причина и по желанию фото справки. Преподаватели и деканат увидят статус."
                />
              ) : (
                <ul className="space-y-3">
                  {data.items.map((leave) => (
                    <li key={leave.id}>
                      <SickLeaveCard leave={leave} active={isActive(leave, now)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function SickLeaveScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadSickLeavePageData(cookieStore.toString());
  return <SickLeaveView result={result} />;
}

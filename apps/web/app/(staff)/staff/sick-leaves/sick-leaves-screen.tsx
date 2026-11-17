/**
 * Экран «Статусы “болею”» кабинета сотрудника деканата.
 *
 * Два среза одной очереди: «болеют сейчас» (период покрывает сегодня) —
 * утренняя сводка «кого не будет на парах», и все отметки с историей.
 * В каждой записи: студент (ФИО, группа), период, причина и факт
 * наличия справки.
 *
 * Фото справок здесь намеренно нет: сотруднику важен ФАКТ наличия
 * документа (services/staffSickLeaves.ts отдаёт только hasAttachment),
 * а путь к файлу в приватном хранилище не покидает packages/core.
 */
import { cookies } from 'next/headers';
import { Card, EmptyState, SegmentedLinks, StatusBadge } from '../../../../components/ui';
import { PageHeader } from '../../../../components/PageHeader';
import { StaffPageResult } from '../../../../components/StaffPageResult';
import { formatDateRange } from '../../../../components/format';
import {
  loadStaffSickLeavesPageData,
  type LoadResult,
  type StaffSickLeavesPageData,
} from '../../../../lib/page-data';

/** Отметка ещё действует: период не закончился (даты — полночь UTC). */
function isActive(leave: StaffSickLeavesPageData['sickLeaves'][number], today: number): boolean {
  return leave.dateFrom.getTime() <= today && leave.dateTo.getTime() >= today;
}

function SickLeaveCard({
  leave,
  today,
}: {
  leave: StaffSickLeavesPageData['sickLeaves'][number];
  today: number;
}): React.JSX.Element {
  const active = isActive(leave, today);

  return (
    <Card className={active ? 'border-warning/40 bg-warning-soft/20' : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{leave.fullName}</h2>
        {active ? <StatusBadge tone="warning">Болеет сейчас</StatusBadge> : <StatusBadge tone="neutral">Завершилась</StatusBadge>}
        {leave.hasAttachment ? (
          <StatusBadge tone="neutral">Справка прикреплена</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Без справки</StatusBadge>
        )}
      </div>

      <dl className="mt-3 space-y-1.5">
        <div className="flex gap-2 text-sm">
          <dt className="w-28 shrink-0 text-text-muted">Группа:</dt>
          <dd className="min-w-0 text-text">{leave.groupName}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-28 shrink-0 text-text-muted">Период:</dt>
          <dd className="min-w-0 text-text">{formatDateRange(leave.dateFrom, leave.dateTo)}</dd>
        </div>
        {leave.reason === null ? null : (
          <div className="flex gap-2 text-sm">
            <dt className="w-28 shrink-0 text-text-muted">Причина:</dt>
            <dd className="min-w-0 text-text">{leave.reason}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-xs text-text-muted">
        {active
          ? 'Преподаватели учитывают отметку в посещаемости.'
          : 'Отметка завершилась.'}
      </p>
    </Card>
  );
}

export function StaffSickLeavesView({
  result,
}: {
  result: LoadResult<StaffSickLeavesPageData>;
}): React.JSX.Element {
  return (
    <StaffPageResult result={result}>
      {(data) => {
        const today = Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate(),
        );
        return (
          <>
            <PageHeader
              title="Статусы «болею»"
              subtitle="Отметки студентов института"
              action={
                <span className="text-sm text-text-muted">
                  {data.onlyActive ? `${data.sickLeaves.length} болеют` : `${data.sickLeaves.length} отметок`}
                </span>
              }
            />

            <div className="mb-4">
              <SegmentedLinks
                label="Фильтр отметок о болезни"
                items={[
                  { href: '/staff/sick-leaves?onlyActive=true', label: 'Болеют сейчас', active: data.onlyActive },
                  { href: '/staff/sick-leaves', label: 'Все отметки', active: !data.onlyActive },
                ]}
              />
            </div>

            {data.onlyActive && data.sickLeaves.length === 0 ? (
              <EmptyState title="Сейчас никто не болеет" />
            ) : data.sickLeaves.length === 0 ? (
              <EmptyState title="Отметок о болезни нет" />
            ) : (
              <ul className="space-y-3">
                {data.sickLeaves.map((leave) => (
                  <li key={leave.id}>
                    <SickLeaveCard leave={leave} today={today} />
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
export async function StaffSickLeavesScreen({ onlyActive }: { onlyActive: boolean }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadStaffSickLeavesPageData(cookieStore.toString(), onlyActive);
  return <StaffSickLeavesView result={result} />;
}

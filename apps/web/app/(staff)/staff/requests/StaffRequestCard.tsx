'use client';

/**
 * Карточка заявки в очереди сотрудника (клиентский остров).
 *
 * Клиентским компонент сделан из-за формы решения: после сохранения
 * список обновляется (router.refresh()), а результат объявляется живой
 * областью. Данные карточки приходят с сервера пропсами — владение
 * проверено в packages/core (сотрудник видит только свой институт).
 */
import { useRouter } from 'next/navigation';
import { Card, StatusBadge } from '../../../../components/ui';
import { formatMoment } from '../../../../components/format';
import { requestFieldLabel, requestStatusTone } from '../../../../components/labels';
import type { StaffRequestItem } from '@udgu/core';
import { RequestDecisionForm } from './RequestDecisionForm';

export function StaffRequestCard({ request }: { request: StaffRequestItem }): React.JSX.Element {
  const router = useRouter();
  const formDataEntries = Object.entries(request.formData);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{request.typeLabel}</h2>
        <StatusBadge tone={requestStatusTone(request.status)}>{request.statusLabel}</StatusBadge>
      </div>

      <dl className="mt-3 space-y-1.5">
        <div className="flex gap-2 text-sm">
          <dt className="w-32 shrink-0 text-text-muted">Студент:</dt>
          <dd className="min-w-0 text-text">{request.student.fullName}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-32 shrink-0 text-text-muted">Группа:</dt>
          <dd className="min-w-0 text-text">{request.student.groupName}</dd>
        </div>
        {formDataEntries.map(([key, value]) => (
          <div key={key} className="flex gap-2 text-sm">
            <dt className="w-32 shrink-0 text-text-muted">{requestFieldLabel(key)}:</dt>
            <dd className="min-w-0 text-text">{value}</dd>
          </div>
        ))}
      </dl>

      {request.staffComment === null ? null : (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text">
          <span className="font-medium">Ваш комментарий: </span>
          {request.staffComment}
        </p>
      )}

      <p className="mt-3 text-xs text-text-muted">
        Подана {formatMoment(new Date(request.createdAt))}
        {request.updatedAt.getTime() === request.createdAt.getTime()
          ? ''
          : ` · изменена ${formatMoment(new Date(request.updatedAt))}`}
      </p>

      {request.status === 'READY' || request.status === 'REJECTED' ? (
        <p className="mt-2 text-xs text-text-muted">
          Заявка закрыта: статус «{request.statusLabel}» изменить нельзя — студент уже получил решение.
        </p>
      ) : (
        <details className="mt-3 rounded-md border border-border bg-surface-2/40 px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Принять решение
          </summary>
          <RequestDecisionForm
            requestId={request.id}
            requestTitle={request.typeLabel}
            currentStatus={request.statusLabel}
            onDone={() => router.refresh()}
          />
        </details>
      )}
    </Card>
  );
}

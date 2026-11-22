'use client';

/**
 * Карточка заявки в очереди сотрудника (клиентский остров).
 *
 * Клиентским компонент сделан из-за формы решения: после сохранения
 * список обновляется (router.refresh()), а результат объявляется живой
 * областью. Данные карточки приходят с сервера пропсами — владение
 * проверено в packages/core (сотрудник видит только свой институт).
 */
import styles from '../../../workspace.module.css';
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
      <div className={styles.recordHeader}>
        <div className={styles.person}>
          <span className={styles.initials} aria-hidden="true">
            {request.student.fullName.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('')}
          </span>
          <div>
            <h2 className="font-semibold text-text">{request.typeLabel}</h2>
            <p className={styles.recordMeta}>{request.student.fullName} · {request.student.groupName}</p>
          </div>
        </div>
        <StatusBadge tone={requestStatusTone(request.status)}>{request.statusLabel}</StatusBadge>
      </div>

      {formDataEntries.length > 0 ? (
        <details className={styles.disclosure}>
          <summary>Данные заявки</summary>
          <dl className={styles.fieldList}>
            {formDataEntries.map(([key, value]) => (
              <div key={key}><dt>{requestFieldLabel(key)}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}

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
          Решение отправлено студенту.
        </p>
      ) : (
        <details className={styles.disclosure}>
          <summary>
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

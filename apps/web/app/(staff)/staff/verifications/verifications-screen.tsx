/**
 * Экран «Верификация студбилетов» кабинета сотрудника деканата.
 *
 * Карточка заявки: ФИО и группа студента, распознанные с фото поля
 * (ФИО, группа, номер билета), балл сверки с реестром и само ФОТО —
 * из приватного хранилища, только через авторизованный маршрут
 * (/api/staff/verifications/[id]/photo, см. VerificationPhoto).
 * Действие: одобрить или отклонить с комментарием.
 *
 * Почему сотруднику показываются распознанные поля: сверка «что на фото»
 * против «что в учётной записи» — это и есть его работа, а балл сверки
 * подсказывает, где искать расхождение.
 */
import { cookies } from 'next/headers';
import { Card, EmptyState, SegmentedLinks, StatusBadge } from '../../../../components/ui';
import { PageHeader } from '../../../../components/PageHeader';
import { StaffPageResult } from '../../../../components/StaffPageResult';
import { formatMoment, formatScore } from '../../../../components/format';
import { VERIFICATION_STATUS_LABELS, verificationStatusTone } from '../../../../components/labels';
import { IconIdCard } from '../../../../components/icons';
import {
  loadStaffVerificationsPageData,
  type LoadResult,
  type StaffVerificationsPageData,
  type StaffVerificationStatusFilter,
} from '../../../../lib/page-data';
import { VerificationPhoto } from './VerificationPhoto';
import { VerificationDecisionForm } from './VerificationDecisionForm';

/** Фильтр очереди: варианты статуса и подписи. */
const FILTERS: readonly { status: StaffVerificationStatusFilter | null; label: string }[] = [
  { status: null, label: 'Все' },
  { status: 'PENDING', label: 'На проверке' },
  { status: 'VERIFIED', label: 'Одобрены' },
  { status: 'REJECTED', label: 'Отказы' },
];

/** Текст балла сверки: сотруднику важнее не число, а что оно значит. */
function matchScoreHint(score: number | null): string {
  if (score === null) {
    return 'Балл сверки не рассчитан — сверьте фото с данными студента вручную.';
  }
  if (score >= 0.9) {
    return `Сверка ${formatScore(score)}: данные на фото совпадают.`;
  }
  if (score >= 0.7) {
    return `Сверка ${formatScore(score)}: частичное совпадение — проверьте группу и номер билета.`;
  }
  return `Сверка ${formatScore(score)}: совпадение слабое — возможно, фото чужого билета.`;
}

/** Карточка заявки на верификацию (серверная; фото и решение — острова). */
function VerificationCard({
  verification,
}: {
  verification: StaffVerificationsPageData['verifications'][number];
}): React.JSX.Element {
  const decided = verification.status !== 'PENDING';

  return (
    <Card data-testid="verification-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{verification.student.fullName}</h2>
        <StatusBadge tone={verificationStatusTone(verification.status)}>
          {VERIFICATION_STATUS_LABELS[verification.status]}
        </StatusBadge>
      </div>

      <dl className="mt-3 space-y-1.5">
        <div className="flex gap-2 text-sm">
          <dt className="w-44 shrink-0 text-text-muted">Группа студента:</dt>
          <dd className="min-w-0 text-text">{verification.student.groupName}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-44 shrink-0 text-text-muted">Распознано с фото:</dt>
          <dd className="min-w-0 text-text">
            {verification.recognizedLastName} {verification.recognizedFirstName}
          </dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-44 shrink-0 text-text-muted">Группа на билете:</dt>
          <dd className="min-w-0 text-text">{verification.recognizedGroupName}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-44 shrink-0 text-text-muted">Номер билета:</dt>
          <dd className="min-w-0 text-text">{verification.recognizedCardNumber}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-text-muted">{matchScoreHint(verification.matchScore)}</p>

      <VerificationPhoto verificationId={verification.id} studentName={verification.student.fullName} />

      <p className="mt-3 text-xs text-text-muted">Заявка подана {formatMoment(new Date(verification.submittedAt))}</p>

      <VerificationDecisionForm
        verificationId={verification.id}
        studentName={verification.student.fullName}
        disabled={decided}
      />
    </Card>
  );
}

export function StaffVerificationsView({
  result,
}: {
  result: LoadResult<StaffVerificationsPageData>;
}): React.JSX.Element {
  return (
    <StaffPageResult result={result}>
      {(data) => {
        const activeFilter = data.status ?? 'ALL';
        return (
          <>
            <PageHeader
              title="Верификация студбилетов"
              subtitle="Проверка фото студбилетов"
              action={
                <span className="text-sm text-text-muted">
                  {data.verifications.length === 0 ? '0 заявок' : `${data.verifications.length} в выборке`}
                </span>
              }
            />

            <div className="mb-4">
              <SegmentedLinks
                label="Фильтр по статусу верификации"
                className="flex-wrap"
                items={FILTERS.map((filter) => ({
                  href:
                    filter.status === null
                      ? '/staff/verifications'
                      : `/staff/verifications?status=${filter.status}`,
                  label: filter.label,
                  active: (filter.status ?? 'ALL') === activeFilter,
                }))}
              />
            </div>

            {data.verifications.length === 0 ? (
              <EmptyState
                title={
                  activeFilter === 'PENDING' ? 'Очередь верификаций пуста' : 'В этом статусе заявок нет'
                }
                icon={<IconIdCard />}
                action={
                  activeFilter === 'PENDING' ? undefined : (
                    <SegmentedLinks
                      label="Показать очередь на проверке"
                      items={[{ href: '/staff/verifications?status=PENDING', label: 'На проверке', active: false }]}
                    />
                  )
                }
              />
            ) : (
              <ul className="space-y-3">
                {data.verifications.map((verification) => (
                  <li key={verification.id}>
                    <VerificationCard verification={verification} />
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
export async function StaffVerificationsScreen({
  status,
}: {
  status: string | undefined;
}): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadStaffVerificationsPageData(cookieStore.toString(), status);
  return <StaffVerificationsView result={result} />;
}

/**
 * Экран «Верификация»: загрузка фото студенческого билета + номер.
 *
 * Статусы заявки (BRIEF v2): PENDING — ждёт решения сотрудника;
 * VERIFIED — открыты оценки и переписка; REJECTED — причина и «подать
 * снова». Фото уходит только на /api/verification и хранится в
 * приватном хранилище: прямых ссылок на файл нет и в интерфейсе тоже.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { formatMoment } from '../../../components/format';
import { VERIFICATION_STATUS_LABELS, verificationStatusTone } from '../../../components/labels';
import { loadVerificationPageData, type LoadResult, type VerificationPageData } from '../../../lib/page-data';
import { VerificationForm } from './VerificationForm';
import { TEXT_LINK_CLASS } from '../../../lib/ui';

export function VerificationView({ result }: { result: LoadResult<VerificationPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        const { verification, profile } = data;
        const status = verification?.status ?? profile.verificationStatus;

        return (
          <>
            <PageHeader
              title="Верификация студбилета"
              subtitle="Один раз — и открываются оценки и переписка"
            />

            {/* Зачем верификация */}
            <Card className="mb-4">
              <h2 className="text-base font-semibold text-text">Зачем это нужно</h2>
              <p className="mt-1 text-sm text-text-muted">
                Кабинет защищает ваши оценки и переписку от чужого доступа: сотрудник деканата сверяет
                фото вашего студенческого билета с реестром университета, и только после этого
                открываются успеваемость и переписка с преподавателями. Фото видите только вы и
                проверяющий сотрудник — оно лежит в приватном хранилище, без публичных ссылок.
              </p>
            </Card>

            {/* Статус заявки */}
            <Card className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-text">Статус</h2>
                <StatusBadge tone={verificationStatusTone(status)}>
                  {VERIFICATION_STATUS_LABELS[status]}
                </StatusBadge>
              </div>

              {verification === null ? (
                <p className="mt-2 text-sm text-text-muted">
                  Заявка ещё не подана. Загрузите фото студенческого билета и укажите его номер —
                  заявка попадёт в очередь на проверку.
                </p>
              ) : (
                <>
                  <dl className="mt-3 space-y-1.5">
                    <div className="flex gap-2 text-sm">
                      <dt className="w-44 shrink-0 text-text-muted">Номер на билете:</dt>
                      <dd className="min-w-0 text-text">{verification.recognizedCardNumber}</dd>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <dt className="w-44 shrink-0 text-text-muted">Распознанные данные:</dt>
                      <dd className="min-w-0 text-text">
                        {verification.recognizedLastName} {verification.recognizedFirstName}
                        {verification.recognizedGroupName === '' ? '' : ` · ${verification.recognizedGroupName}`}
                      </dd>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <dt className="w-44 shrink-0 text-text-muted">Отправлена:</dt>
                      <dd className="min-w-0 text-text">{formatMoment(new Date(verification.submittedAt))}</dd>
                    </div>
                  </dl>

                  {status === 'PENDING' ? (
                    <p className="mt-3 text-sm text-text-muted">
                      Заявка ждёт решения сотрудника деканата — обычно это занимает до трёх рабочих
                      дней. Мы пришлём уведомление, когда решение будет принято.
                    </p>
                  ) : null}

                  {status === 'REJECTED' && verification.reviewComment !== null ? (
                    <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                      <span className="font-medium">Причина отказа: </span>
                      {verification.reviewComment}
                    </p>
                  ) : null}

                  {status === 'VERIFIED' ? (
                    <p className="mt-3 text-sm text-success">
                      Студенческий билет подтверждён. Открыты успеваемость и переписка с
                      преподавателями.{' '}
                      <Link href="/grades" className={TEXT_LINK_CLASS}>
                        Перейти к успеваемости
                      </Link>
                    </p>
                  ) : null}
                </>
              )}
            </Card>

            {/* Форма: пока заявки не было или после отказа */}
            {status === 'PENDING' || status === 'VERIFIED' ? null : (
              <VerificationForm />
            )}
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function VerificationScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadVerificationPageData(cookieStore.toString());
  return <VerificationView result={result} />;
}

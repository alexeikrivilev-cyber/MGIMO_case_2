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
                Сотрудник сверяет фото студбилета с реестром — после этого откроются оценки и переписка.
              </p>
              <details className="mt-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  Где хранится фото
                </summary>
                <p className="pb-1 text-sm text-text-muted">
                  В приватном хранилище: фото видите только вы и проверяющий сотрудник, публичных ссылок
                  нет.
                </p>
              </details>
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
                  Заявка не подана: загрузите фото студбилета и укажите его номер.
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
                      Заявка ждёт решения сотрудника. Пришлём уведомление.
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
                      Билет подтверждён. Открыты успеваемость и переписка.{' '}
                      <Link href="/grades" className={TEXT_LINK_CLASS}>
                        К успеваемости
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

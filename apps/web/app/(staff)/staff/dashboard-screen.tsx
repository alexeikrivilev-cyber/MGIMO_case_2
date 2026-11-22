/**
 * Экран «Сводка» кабинета сотрудника деканата.
 *
 * Показывает очереди ЕГО института (ARCHITECTURE §4): заявки на обработке,
 * верификации студбилетов, кто болеет прямо сейчас и изменения расписания
 * на сегодня. Каждый счётчик — ссылка на раздел, где очередь
 * обрабатывается: сводка отвечает на вопрос «что ждёт меня сегодня», а не
 * дублирует списки.
 *
 * Очереди пусты — это не ошибка: отдельная карточка объясняет, что всё
 * обработано, и предлагает проверить объявления и расписание.
 *
 * Пользователь с профилем преподавателя (isTeacher из сессии) дополнительно
 * видит ссылку на кабинет преподавателя: discoverability BRIEF v4 — свой
 * раздел находится из любого места. Преподаватель без факультета в сводку
 * не попадает (requireStaffScope → STAFF_ONLY): его /staff показывает
 * честное «раздел недоступен» с путём в кабинет преподавателя
 * (StaffPageResult, флаг teacherCabinet из сессии).
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, EmptyState, LinkButton, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { StaffPageResult } from '../../../components/StaffPageResult';
import styles from '../../workspace.module.css';
import { IconMove, IconRequests } from '../../../components/icons';
import { loadStaffDashboardPageData, type LoadResult, type StaffDashboardPageData } from '../../../lib/page-data';

/** Плитка очереди: счётчик + подпись + куда ведёт. */
function QueueTile({ count, label, href, linkLabel, testId }: {
  count: number;
  label: string;
  href: string;
  linkLabel: string;
  testId: string;
}): React.JSX.Element {
  return (
    <Link href={href} data-testid={testId} className={`${styles.metric} ${styles['focus-visible']}`} aria-label={`${linkLabel} · ${count}`}>
      <span className={styles.metricCount}><strong>{count}</strong><i aria-hidden="true">↗</i></span>
      <span className={styles.metricLabel}>{label}</span>
      {/* Глубина очереди словом: крупная цифра говорит «сколько», подпись
          «N в очереди» / «Пусто» придаёт ей смысл без опоры на контекст
          и цвет (сторож видимости счётчика, требование кейса). */}
      <span className={styles.metricQueue}>{count > 0 ? `${count} в очереди` : 'Пусто'}</span>
    </Link>
  );
}

function SectionLink({ href, title }: {href: string; title: string}): React.JSX.Element {
  return <li><Link className={`${styles.rowLink} ${styles['focus-visible']}`} href={href}><span>{title}</span><span aria-hidden="true">↗</span></Link></li>;
}

export function StaffDashboardView({ result }: { result: LoadResult<StaffDashboardPageData> }): React.JSX.Element {
  return (
    <StaffPageResult result={result}>
      {(data) => {
        const { dashboard } = data;
        const scope = dashboard.faculty === null ? 'Все институты университета' : dashboard.faculty;
        const totalQueues = dashboard.newRequests + dashboard.pendingVerifications;

        return (
          <>
            <PageHeader title="Кабинет деканата" subtitle={scope} />

            <div className={styles.workload}>
              <QueueTile
                testId="queue-requests"
                count={dashboard.newRequests}
                label="Заявки и справки"

                href="/staff/requests"
                linkLabel="Открыть очередь заявок"
              />
              <QueueTile
                testId="queue-verifications"
                count={dashboard.pendingVerifications}
                label="Верификация студбилетов"

                href="/staff/verifications"
                linkLabel="Открыть очередь верификаций"

              />
              <QueueTile
                testId="queue-sick"
                count={dashboard.sickNow}
                label="Статусы «болею»"

                href="/staff/sick-leaves"
                linkLabel="Смотреть, кто болеет"

              />
            </div>

            <section aria-labelledby="staff-today" className="mt-6">
              <h2 id="staff-today" className="mb-2 text-base font-semibold text-text">
                Изменения расписания на сегодня
              </h2>
              {dashboard.todayScheduleChanges === 0 ? (
                <EmptyState
                  title="На сегодня изменений нет"
                  icon={<IconMove />}
                  action={
                    <LinkButton href="/staff/schedule" variant="secondary">
                      Открыть расписание
                    </LinkButton>
                  }
                />
              ) : (
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm text-text">
                      Изменений на сегодня: <span className="font-semibold">{dashboard.todayScheduleChanges}</span>
                    </p>
                    <StatusBadge tone="warning">{dashboard.todayMovedIn} перенесено на сегодня</StatusBadge>
                  </div>
                  <div className="mt-3">
                    <LinkButton href="/staff/schedule" variant="secondary">
                      Открыть расписание
                    </LinkButton>
                  </div>
                </Card>
              )}
            </section>

            {totalQueues === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="Очереди обработаны"
                  icon={<IconRequests />}
                  action={
                    <LinkButton href="/staff/announcements">
                      Опубликовать объявление
                    </LinkButton>
                  }
                />
              </div>
            ) : null}

            <section aria-labelledby="staff-sections" className="mt-6">
              <h2 id="staff-sections" className="mb-2 text-base font-semibold text-text">
                Быстрый переход
              </h2>
              <ul className={styles.shortcuts}>
                {data.isTeacher ? (
                  <SectionLink
                    href="/teacher/plans"
                    title="Кабинет преподавателя"

                  />
                ) : null}
                <SectionLink
                  href="/staff/announcements"
                  title="Объявления"

                />
                <SectionLink
                  href="/staff/schedule"
                  title="Расписание групп"

                />
              </ul>
            </section>
          </>
        );
      }}
    </StaffPageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function StaffDashboardScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadStaffDashboardPageData(cookieStore.toString());
  return <StaffDashboardView result={result} />;
}

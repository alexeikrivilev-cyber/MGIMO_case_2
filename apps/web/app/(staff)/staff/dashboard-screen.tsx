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
import { FOCUS_RING, PRESS_FEEDBACK } from '../../../lib/ui';
import { IconMove, IconRequests } from '../../../components/icons';
import { loadStaffDashboardPageData, type LoadResult, type StaffDashboardPageData } from '../../../lib/page-data';

/** Плитка очереди: счётчик + подпись + куда ведёт. */
function QueueTile({
  count,
  label,
  hint,
  href,
  linkLabel,
  tone = 'info',
  testId,
}: {
  count: number;
  label: string;
  hint: string;
  href: string;
  linkLabel: string;
  tone?: 'info' | 'warning' | 'success';
  testId: string;
}): React.JSX.Element {
  return (
    <Card data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{label}</h2>
        <StatusBadge tone={count > 0 ? tone : 'neutral'}>{count > 0 ? `${count} в очереди` : 'Пусто'}</StatusBadge>
      </div>
      <p className="mt-1.5 text-sm text-text-muted">{hint}</p>
      <div className="mt-3">
        <LinkButton href={href} variant="secondary" className="min-h-11">
          {linkLabel}
        </LinkButton>
      </div>
    </Card>
  );
}

/** Ссылка на раздел с пояснением — быстрый путь ко всем частям кабинета. */
function SectionLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm ${PRESS_FEEDBACK} hover:bg-surface-2 ${FOCUS_RING}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">{title}</span>
          <span className="mt-0.5 block text-xs text-text-muted">{description}</span>
        </span>
      </Link>
    </li>
  );
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
            <PageHeader title="Кабинет деканата" subtitle={`Очереди и задачи: ${scope}`} />

            <div className="space-y-3">
              <QueueTile
                testId="queue-requests"
                count={dashboard.newRequests}
                label="Заявки и справки"
                hint="Ждут вашего решения."
                href="/staff/requests"
                linkLabel="Открыть очередь заявок"
              />
              <QueueTile
                testId="queue-verifications"
                count={dashboard.pendingVerifications}
                label="Верификация студбилетов"
                hint="Проверка фото против учётной записи."
                href="/staff/verifications"
                linkLabel="Открыть очередь верификаций"
                tone="warning"
              />
              <QueueTile
                testId="queue-sick"
                count={dashboard.sickNow}
                label="Статусы «болею»"
                hint="Кто отмечен болеющим сейчас."
                href="/staff/sick-leaves"
                linkLabel="Смотреть, кто болеет"
                tone="warning"
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
                Разделы кабинета
              </h2>
              <ul className="space-y-2">
                {data.isTeacher ? (
                  <SectionLink
                    href="/teacher/plans"
                    title="Кабинет преподавателя"
                    description="Учебные планы и ассистент"
                  />
                ) : null}
                <SectionLink
                  href="/staff/requests"
                  title="Заявки и справки"
                  description="Очередь заявок института"
                />
                <SectionLink
                  href="/staff/verifications"
                  title="Верификация студбилетов"
                  description="Очередь проверки фото"
                />
                <SectionLink
                  href="/staff/sick-leaves"
                  title="Статусы «болею»"
                  description="Период, причина, справка"
                />
                <SectionLink
                  href="/staff/announcements"
                  title="Объявления"
                  description="Публикация для института или группы"
                />
                <SectionLink
                  href="/staff/schedule"
                  title="Расписание групп"
                  description="Перенос и отмена пар"
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

/**
 * Экран «Расписание»: режимы «Сегодня» и «Неделя».
 *
 * Переключатель режима и стрелки недели — серверные ссылки (query
 * view/offset): экран перерисовывается на сервере, работает без JS и
 * без второй реализации выбора на клиенте. Статусы пар (MOVED /
 * CANCELLED) показывает LessonRow с бейджем и причиной.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, EmptyState, SegmentedLinks } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult, SectionTitle } from '../../../components/PageStates';
import { LessonRow } from '../../../components/LessonRow';
import { DayTimeline } from '../../../components/DayTimeline';
import { formatDateRange, formatDateWithYear, weekdayShort } from '../../../components/format';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '../../../components/icons';
import { loadSchedulePageData, type LoadResult, type SchedulePageData } from '../../../lib/page-data';
import { PRESS_FEEDBACK, TEXT_LINK_CLASS } from '../../../lib/ui';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Кнопка-стрелка переключения недели (серверная ссылка). */
function WeekArrow({ href, direction, label }: { href: string; direction: 'prev' | 'next'; label: string }): React.JSX.Element {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text ${PRESS_FEEDBACK} ${FOCUS_RING}`}
    >
      {direction === 'prev' ? <IconChevronLeft /> : <IconChevronRight />}
    </Link>
  );
}

export function ScheduleView({
  result,
  now = new Date(),
}: {
  result: LoadResult<SchedulePageData>;
  /** Момент «сейчас» для рельса дня: серверная обёртка передаёт new Date(),
   *  тесты — фиксированное время (детерминированный рендер). */
  now?: Date;
}): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        const weekHref = `/schedule?view=week&offset=${data.offset}`;
        const todayHref = '/schedule?view=today';

        return (
          <>
            <PageHeader
              title="Расписание"
              subtitle={`Группа ${data.profile.groupName} · ${data.profile.course} курс`}
            />

            {/* Переключатель вида + стрелки недели */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SegmentedLinks
                label="Режим расписания"
                items={[
                  { href: todayHref, label: 'Сегодня', active: data.view === 'today' },
                  { href: weekHref, label: 'Неделя', active: data.view === 'week' },
                ]}
              />
              {data.view === 'week' ? (
                <div className="flex items-center gap-2">
                  <WeekArrow
                    href={`/schedule?view=week&offset=${data.offset - 1}`}
                    direction="prev"
                    label="Предыдущая неделя"
                  />
                  <WeekArrow
                    href={`/schedule?view=week&offset=${data.offset + 1}`}
                    direction="next"
                    label="Следующая неделя"
                  />
                  {data.offset === 0 ? null : (
                    <Link
                      href={weekHref}
                      className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline decoration-dotted"
                    >
                      Текущая неделя
                    </Link>
                  )}
                </div>
              ) : null}
            </div>

            {data.view === 'today' ? (
              <>
                <Card className="mb-4">
                  <SectionTitle>Пары на сегодня</SectionTitle>
                  {data.todayLessons.length === 0 ? (
                    <EmptyState title="Сегодня пар нет" icon={<IconCalendar />} />
                  ) : (
                    /* Рельс дня (волна 2): точки на парах, пунктир окон и
                       отметка «сейчас» в хронологической позиции. */
                    <DayTimeline lessons={data.todayLessons} gaps={data.freeGaps} now={now} />
                  )}
                </Card>
              </>
            ) : null}

            {data.view === 'week' && data.week !== null ? (
              <>
                <p className="mb-2 text-sm text-text-muted">
                  {data.offset === 0 ? 'Текущая неделя' : data.offset > 0 ? 'Следующая неделя' : 'Прошедшая неделя'}:{' '}
                  {formatDateRange(data.week.weekStart, data.week.weekEnd)}
                </p>
                <div className="space-y-4">
                  {data.week.days.map((day) => (
                    <section key={day.date.toISOString()} aria-labelledby={`day-${day.date.toISOString()}`}>
                      <SectionTitle>
                        <span id={`day-${day.date.toISOString()}`}>
                          {weekdayShort(day.weekday)}, {formatDateWithYear(day.date)}
                        </span>
                      </SectionTitle>
                      <Card>
                        {day.lessons.length === 0 ? (
                          <p className="py-1 text-sm text-text-muted">Занятий нет</p>
                        ) : (
                          <ul>
                            {day.lessons.map((lesson) => (
                              <LessonRow key={lesson.id} lesson={lesson} />
                            ))}
                          </ul>
                        )}
                      </Card>
                    </section>
                  ))}
                </div>
              </>
            ) : null}

            <Card className="mt-4">
              <p className="text-sm text-text-muted">
                Когда преподаватель свободен?{' '}
                <Link href="/teachers" className={TEXT_LINK_CLASS}>
                  Расписание преподавателей
                </Link>
              </p>
            </Card>
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка: query → данные → вид. */
export async function ScheduleScreen({
  view,
  offset,
}: {
  view: string | undefined;
  offset: string | undefined;
}): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadSchedulePageData(cookieStore.toString(), view, offset);
  return <ScheduleView result={result} now={new Date()} />;
}

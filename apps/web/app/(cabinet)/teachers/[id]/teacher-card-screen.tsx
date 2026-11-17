/**
 * Экран карточки преподавателя: расписание на две недели + часы
 * приёма/консультации (BRIEF v2 — студенту нужно знать, когда можно
 * подойти). Общедоступная информация кабинета: идентификатор
 * преподавателя не является идентификатором владения данными, поэтому
 * неизвестный id даёт понятное «не найдено», а не ошибку доступа.
 */
import Link from 'next/link';
import { Card, EmptyState, StatusBadge } from '../../../../components/ui';
import { PageHeader } from '../../../../components/PageHeader';
import { PageResult, SectionTitle } from '../../../../components/PageStates';
import { LessonRow } from '../../../../components/LessonRow';
import { IconChevronLeft } from '../../../../components/icons';
import type { LoadResult } from '../../../../lib/page-data';
import type { TeacherCard } from '@udgu/core';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function TeacherCardView({ result }: { result: LoadResult<TeacherCard> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(teacher) => (
        <>
          <Link
            href="/teachers"
            className={`mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary underline decoration-dotted ${FOCUS_RING}`}
          >
            <IconChevronLeft />
            Все преподаватели
          </Link>

          <PageHeader title={teacher.fullName} subtitle={`${teacher.position} · ${teacher.department}`} />

          <section className="mb-6" aria-labelledby="teacher-schedule">
            <SectionTitle>
              <span id="teacher-schedule">Расписание на две недели</span>
            </SectionTitle>
            {teacher.lessons.length === 0 ? (
              <EmptyState title="На две недели пар нет" />
            ) : (
              <Card>
                <ul>
                  {teacher.lessons.map((lesson) => (
                    <LessonRow
                      key={lesson.id}
                      lesson={lesson}
                      showGroup
                      groupName={lesson.groupName}
                    />
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section aria-labelledby="office-hours">
            <SectionTitle>
              <span id="office-hours">Часы приёма и консультации</span>
            </SectionTitle>
            {teacher.officeHours.length === 0 ? (
              <EmptyState title="Часов приёма нет" />
            ) : (
              <ul className="space-y-2">
                {teacher.officeHours.map((hour) => (
                  <li key={hour.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="info">{hour.typeLabel}</StatusBadge>
                        <p className="text-sm font-medium text-text">
                          {hour.weekdayLabel}, {hour.startTime}—{hour.endTime}
                        </p>
                        <p className="text-sm text-text-muted">{hour.room}</p>
                      </div>
                      {hour.note === null ? null : (
                        <p className="mt-1.5 text-sm text-text-muted">{hour.note}</p>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-4 text-xs text-text-muted">Часы приёма — регулярное недельное расписание.</p>
        </>
      )}
    </PageResult>
  );
}

export { TeacherCardView };

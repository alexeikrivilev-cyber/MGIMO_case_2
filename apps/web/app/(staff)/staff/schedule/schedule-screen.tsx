/**
 * Экран «Расписание групп» кабинета сотрудника деканата: пары групп
 * института за период с переносом и отменой (BRIEF v2 §6).
 *
 * Перенесённые и отменённые пары оформлены ФОРМОЙ И ТЕКСТОМ, не только
 * цветом: отдельный бейдж («Перенесена»/«Отменена»), новая дата и
 * аудитория у переноса, причина у отмены (требование ACCEPTANCE —
 * студент видит те же отметки в своём расписании).
 *
 * Форма изменения живёт в раскрывающемся блоке карточки: сетка остаётся
 * читаемой, а действие открывается ровно у той пары, которую меняют.
 * Период переключается ссылками с query — состояние в адресе.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, EmptyState, LinkButton, StatusBadge } from '../../../../components/ui';
import { PageHeader } from '../../../../components/PageHeader';
import { StaffPageResult } from '../../../../components/StaffPageResult';
import { formatDate, formatDayLabel, weekdayShort } from '../../../../components/format';
import { IconCalendar } from '../../../../components/icons';
import { addUtcDays, dateKey, type StaffLessonItem } from '@udgu/core';
import {
  loadStaffSchedulePageData,
  type LoadResult,
  type StaffSchedulePageData,
  type StaffScheduleDay,
} from '../../../../lib/page-data';
import { LessonChangeForm } from './LessonChangeForm';

/** Тон бейджа статуса пары (цвет сопровождает текст, не заменяет его). */
function statusTone(status: StaffLessonItem['status']): 'neutral' | 'warning' | 'danger' {
  switch (status) {
    case 'SCHEDULED':
      return 'neutral';
    case 'MOVED':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
  }
}

/** Пояснение к статусу пары — что видит студент и что с этим делать. */
function statusExplanation(lesson: StaffLessonItem): string {
  if (lesson.status === 'MOVED') {
    const to = lesson.movedToDate === null ? '' : formatDate(lesson.movedToDate);
    const room = lesson.movedToRoom === null || lesson.movedToRoom === '' ? '' : `, аудитория ${lesson.movedToRoom}`;
    return `Перенесена на ${to}${room}.`;
  }
  if (lesson.status === 'CANCELLED') {
    return `Отменена${lesson.note === null ? '' : `: ${lesson.note}`}.`;
  }
  return 'Пара идёт по расписанию.';
}

function LessonCard({ lesson }: { lesson: StaffLessonItem }): React.JSX.Element {
  const changed = lesson.status !== 'SCHEDULED';

  return (
    <Card className={changed ? 'border-warning/40' : undefined} data-testid="staff-lesson">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-text">
          {lesson.startTime}—{lesson.endTime} · {lesson.subjectName}
        </h3>
        <StatusBadge tone={statusTone(lesson.status)}>{lesson.statusLabel}</StatusBadge>
      </div>

      <dl className="mt-2 space-y-1.5">
        <div className="flex gap-2 text-sm">
          <dt className="w-28 shrink-0 text-text-muted">Группа:</dt>
          <dd className="min-w-0 text-text">{lesson.groupName}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-28 shrink-0 text-text-muted">Преподаватель:</dt>
          <dd className="min-w-0 text-text">{lesson.teacherName}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-28 shrink-0 text-text-muted">Аудитория:</dt>
          <dd className="min-w-0 text-text">{lesson.room}</dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="w-28 shrink-0 text-text-muted">Тип:</dt>
          <dd className="min-w-0 text-text">{lesson.typeLabel}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-text-muted">{statusExplanation(lesson)}</p>

      {lesson.status === 'CANCELLED' ? null : (
        <details className="mt-3 rounded-md border border-border bg-surface-2/40 px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Перенести или отменить
          </summary>
          <LessonChangeForm
            lessonId={lesson.id}
            date={dateKey(lesson.date)}
            room={lesson.room}
            subjectName={lesson.subjectName}
            groupName={lesson.groupName}
          />
        </details>
      )}
    </Card>
  );
}

function DaySection({ day }: { day: StaffScheduleDay }): React.JSX.Element {
  const date = new Date(`${day.date}T00:00:00.000Z`);
  // weekdayShort ждёт 1 — понедельник; getUTCDay даёт 0 — воскресенье.
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();

  return (
    <section aria-labelledby={`staff-day-${day.date}`}>
      <h2 id={`staff-day-${day.date}`} className="mb-2 text-base font-semibold text-text">
        {formatDayLabel(date)}, {weekdayShort(weekday)}
      </h2>
      <ul className="space-y-3">
        {day.lessons.map((lesson) => (
          <li key={lesson.id}>
            <LessonCard lesson={lesson} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ссылки на соседние двухнедельные окна (состояние периода в адресе). */
function periodShift(from: string, days: number): string {
  const shifted = addUtcDays(new Date(`${from}T00:00:00.000Z`), days);
  return dateKey(shifted);
}

export function StaffScheduleView({
  result,
}: {
  result: LoadResult<StaffSchedulePageData>;
}): React.JSX.Element {
  return (
    <StaffPageResult result={result}>
      {(data) => (
        <>
          <PageHeader
            title="Расписание групп"
            subtitle={`Пары групп института: ${formatDate(new Date(`${data.from}T00:00:00.000Z`))} — ${formatDate(
              new Date(`${data.to}T00:00:00.000Z`),
            )}`}
            action={
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/staff/schedule?from=${periodShift(data.from, -14)}&to=${periodShift(data.to, -14)}`} variant="secondary">
                  Раньше
                </LinkButton>
                <LinkButton href={`/staff/schedule?from=${periodShift(data.from, 14)}&to=${periodShift(data.to, 14)}`} variant="secondary">
                  Позже
                </LinkButton>
              </div>
            }
          />

          {data.days.length === 0 ? (
            <EmptyState
              title="На этот период пар нет"
              icon={<IconCalendar />}
              action={
                <LinkButton href="/staff/schedule" variant="secondary">
                  Текущие две недели
                </LinkButton>
              }
            />
          ) : (
            <div className="space-y-6">
              {data.days.map((day) => (
                <DaySection key={day.date} day={day} />
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-text-muted">
            Студенты видят изменения сразу и получают уведомление.{' '}
            <Link href="/staff/requests" className="font-medium text-primary underline decoration-dotted py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Очередь заявок
            </Link>
          </p>
        </>
      )}
    </StaffPageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function StaffScheduleScreen({
  from,
  to,
}: {
  from: string | undefined;
  to: string | undefined;
}): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadStaffSchedulePageData(cookieStore.toString(), from, to);
  return <StaffScheduleView result={result} />;
}

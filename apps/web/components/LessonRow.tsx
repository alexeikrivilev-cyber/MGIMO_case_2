/**
 * Строка занятия: время, предмет, тип, преподаватель, аудитория +
 * заметная отметка переноса/отмены (требование кейса).
 *
 * Перенос (MOVED): бейдж «Перенесена» + новая дата и аудитория
 * (changeHint из packages/core уже содержит человекочитаемый текст).
 * Отмена (CANCELLED): запись приглушена и зачёркнута, причина — текстом
 * (статус кодируется формой И словом, не только цветом).
 *
 * Компонент презентационный: данные приходят из сервиса расписания,
 * на клиенте никакой логики нет.
 */
import Link from 'next/link';
import type { ScheduleLesson } from '@udgu/core';
import { StatusBadge } from './ui';
import { FOCUS_RING } from '../lib/ui';

export function LessonRow({
  lesson,
  showGroup = false,
  groupName,
}: {
  lesson: ScheduleLesson;
  /** В расписании преподавателя показываем ещё и группу. */
  showGroup?: boolean;
  groupName?: string;
}): React.JSX.Element {
  const cancelled = lesson.status === 'CANCELLED';
  const moved = lesson.status === 'MOVED';

  return (
    <li
      className="flex gap-3 border-b border-border py-3 last:border-b-0"
      data-status={lesson.status}
    >
      <div className="w-[4.5rem] shrink-0 text-sm font-medium tabular-nums text-text-muted">
        <p>{lesson.startTime}</p>
        <p className="text-xs">{lesson.endTime}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium text-text ${cancelled ? 'line-through decoration-2' : ''}`}>
          {lesson.subjectName}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {lesson.typeLabel} · {lesson.room}
          {showGroup === true && groupName !== undefined ? ` · группа ${groupName}` : ''}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          <Link
            href={`/teachers/${lesson.teacherId}`}
            className={`inline-flex min-h-6 items-center underline decoration-dotted hover:text-text ${FOCUS_RING}`}
          >
            {lesson.teacherName}
          </Link>
        </p>
        {moved === true ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="warning">Перенесена</StatusBadge>
            {lesson.changeHint === null ? null : (
              <span className="text-xs text-warning">{lesson.changeHint}</span>
            )}
          </div>
        ) : null}
        {cancelled === true ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="danger">Отменена</StatusBadge>
            {lesson.changeHint === null ? null : (
              <span className="text-xs text-text-muted">{lesson.changeHint}</span>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

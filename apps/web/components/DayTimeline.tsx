/**
 * Рельс дня: расписание «Сегодня» как вертикальная ось (артефакт
 * docs/design/ui-alive-wave-2.html, раздел 2).
 *
 * Зачем: список пар не показывает форму дня — «какая пара сейчас, где
 * окна». Рельс добавляет к рядам LessonRow только точки на линии,
 * пунктир окон и отметку «сейчас» в хронологической позиции. Содержимое
 * ряда — как в LessonRow, время остаётся в ряду: дублирования времени
 * с рельсом нет.
 *
 * Состояние несут форма И текст (не только цвет): прошедшая пара —
 * залитая точка, текущая — залитая с кольцом и чипом «Сейчас»,
 * следующая — чип «Далее», отменённая — точка danger (ряд и так зачёркнут
 * и с бейджем). Приглушение не сильнее text-text-muted — контраст.
 *
 * Чистый серверный рендер: now приходит пропом (вид отдаёт new Date(),
 * тесты — фиксированный момент), никаких setInterval и тиков. Шкала
 * часов не рисуется: «сейчас» — единственная привязка ко времени.
 *
 * Минуты «сейчас» читаем UTC-геттерами: день расписания и мгновения пар
 * привязаны к UTC (startOfUtcDay / toOccurrence в packages/core
 * services/schedule.ts), локальный часовой пояс хоста сдвинуть рельс не
 * должен. Иначе рельс на хосте UTC+4 утверждает, что день ещё не начался,
 * когда все пары уже закончились, и противоречит «Ближайшей паре».
 */
import Link from 'next/link';
import type { FreeGap, ScheduleLesson } from '@udgu/core';
import { StatusBadge } from './ui';
import { formatDuration } from './format';
import { FOCUS_RING } from '../lib/ui';

/** Кольцо «сейчас» — через токен primary-soft, без хардкода цвета. */
const NOW_RING = 'shadow-[0_0_0_3px_var(--udgu-color-primary-soft)]';

const NOW_CHIP =
  'inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-on-primary';
const NEXT_CHIP =
  'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-muted';

/** Положение пары относительно now. */
type LessonState = 'done' | 'current' | 'future';

/**
 * «HH:MM» → минуты от полуночи. Чистая функция: сравнение времён пар
 * (строки «HH:MM» из БД) с моментом now идёт в одной шкале минут.
 * Неразборчивая строка даёт NaN — все сравнения ложны, пара считается
 * будущей (хуже не становится: маркеры не врут).
 */
function minutesOfTime(time: string): number {
  const [hours = '', minutes = ''] = time.split(':');
  const total = Number(hours) * 60 + Number(minutes);
  return Number.isFinite(total) ? total : Number.NaN;
}

/** Точка пары на рельсе: заливка — положение во времени, рамка — отмена. */
function lessonDotClass(state: LessonState, cancelled: boolean): string {
  const fill = state === 'future' ? 'bg-surface' : 'bg-primary';
  const border =
    cancelled === true ? 'border-danger' : state === 'future' ? 'border-border' : 'border-primary';
  return `size-2.5 rounded-full border-2 ${border} ${fill}${state === 'current' ? ` ${NOW_RING}` : ''}`;
}

/** Ряд рельса: пара, окно или отметка «сейчас». */
type RailRow =
  | { readonly kind: 'lesson'; readonly lesson: ScheduleLesson; readonly state: LessonState; readonly chip: 'now' | 'next' | null }
  | { kind: 'gap'; durationMinutes: number }
  | { kind: 'now'; neutral: boolean };

export function DayTimeline({
  lessons,
  gaps,
  now,
}: {
  lessons: readonly ScheduleLesson[];
  gaps: readonly FreeGap[];
  now: Date;
}): React.JSX.Element {
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const states: LessonState[] = lessons.map((lesson) => {
    const start = minutesOfTime(lesson.startTime);
    const end = minutesOfTime(lesson.endTime);
    if (end <= nowMinutes) return 'done';
    if (start <= nowMinutes && nowMinutes < end) {
      // Отменённая пара не идёт, поэтому «текущей» не бывает: чип
      // «Сейчас» в её слоте берёт на себя маркер-строка.
      return lesson.status === 'CANCELLED' ? 'future' : 'current';
    }
    return 'future';
  });
  const currentIndex = states.indexOf('current');
  // «Далее» — следующая РЕАЛЬНАЯ пара: отменённая следующей не бывает.
  const nextIndex = states.findIndex(
    (state, index) => state === 'future' && lessons[index].status !== 'CANCELLED',
  );

  // Позиция отметки «сейчас»: индекс пары, ПЕРЕД которой она стоит;
  // lessons.length — после последней; -1 — маркера нет (идёт пара или пар нет).
  let markerIndex = -1;
  if (currentIndex === -1 && lessons.length > 0) {
    if (nowMinutes < minutesOfTime(lessons[0].startTime)) {
      markerIndex = 0;
    } else {
      // Маркер встаёт перед первой парой, которая ещё не закончилась:
      // это и «до первой пары», и «внутри окна», и «после последней».
      const upcoming = lessons.findIndex((lesson) => minutesOfTime(lesson.endTime) > nowMinutes);
      markerIndex = upcoming === -1 ? lessons.length : upcoming;
    }
  }
  const neutralMarker = markerIndex === lessons.length;

  // Хронологические ряды: пара → её окно → (маркер внутри окна) → пара…
  const rows: RailRow[] = [];
  const usedGaps = new Set<number>();
  let markerPlaced = false;
  const placeMarker = (): void => {
    if (markerPlaced) return;
    rows.push({ kind: 'now', neutral: neutralMarker });
    markerPlaced = true;
  };

  for (const [index, lesson] of lessons.entries()) {
    if (markerIndex === index) {
      placeMarker();
    }

    const state = states[index] ?? 'future';
    const chip: 'now' | 'next' | null =
      state === 'current' ? 'now' : index === nextIndex ? 'next' : null;
    rows.push({ kind: 'lesson', lesson, state, chip });

    const next = lessons[index + 1];
    if (next === undefined) continue;

    // Окно из пропа gaps ровно между этими парами (границы совпадают) —
    // обычный день: подпись из сервиса. Если окна сервиса не совпали с
    // рядами рельса (getFreeGaps считает окна по фактическим занятиям:
    // отменённая/перенесённая пара на рельсе есть, а в окнах её нет;
    // пара, перенесённая НА сегодня, в окнах занимает слот, но на рельсе
    // не отрисована), подпись берём из самого промежутка между парами:
    // иначе рельс покажет окно, не совпадающее с расстоянием между ними.
    const gapIndex = gaps.findIndex(
      (gap, gapPosition) =>
        usedGaps.has(gapPosition) === false &&
        minutesOfTime(gap.startTime) === minutesOfTime(lesson.endTime) &&
        minutesOfTime(gap.endTime) === minutesOfTime(next.startTime),
    );
    const gap = gapIndex === -1 ? undefined : gaps[gapIndex];
    const endMinutes = minutesOfTime(lesson.endTime);
    const nextStart = minutesOfTime(next.startTime);
    if (gap !== undefined) {
      usedGaps.add(gapIndex);
      rows.push({ kind: 'gap', durationMinutes: gap.durationMinutes });
    } else if (nextStart > endMinutes) {
      rows.push({ kind: 'gap', durationMinutes: nextStart - endMinutes });
    }

    if (markerIndex === index + 1) {
      placeMarker();
    }
  }
  if (markerIndex === lessons.length) {
    placeMarker();
  }

  return (
    <ol className="relative pl-5">
      {/* Рельс: вертикальная линия под всеми точками (li — валидный
          ребёнок ol; aria-hidden убирает декор из дерева скринридера). */}
      <li aria-hidden="true" className="absolute left-1 top-2 bottom-2 w-0.5 bg-border" />
      {rows.map((row, index) => {
        if (row.kind === 'gap') {
          return (
            <li key={`gap-${index}`} className="relative py-[3px]">
              <span
                aria-hidden="true"
                className="absolute -left-4 top-2 w-2 border-t-2 border-dashed border-border"
              />
              {/* Скринридеру «1 ч 50 мин» без контекста — бессмысленный
                  пункт списка: префикс называет ряд окном (визуально скрыт). */}
              <span className="sr-only">Окно </span>
              <span className="text-xs tabular-nums text-text-muted">
                {formatDuration(row.durationMinutes)}
              </span>
            </li>
          );
        }

        if (row.kind === 'now') {
          return (
            <li key={`now-${index}`} className="relative py-1.5">
              <span
                className={`absolute -left-5 top-[14px] size-2.5 rounded-full border-2 ${
                  row.neutral === true ? 'border-border bg-surface' : `border-primary bg-primary ${NOW_RING}`
                }`}
              />
              <span className={row.neutral === true ? NEXT_CHIP : NOW_CHIP}>Сейчас</span>
            </li>
          );
        }

        const { lesson, state, chip } = row;
        const cancelled = lesson.status === 'CANCELLED';
        const moved = lesson.status === 'MOVED';
        return (
          <li key={lesson.id} className="relative py-2" data-status={lesson.status}>
            <span className={`absolute -left-5 top-[14px] ${lessonDotClass(state, cancelled)}`} />
            <div className="flex gap-3">
              <div className="w-[4.5rem] shrink-0 text-sm font-medium tabular-nums text-text-muted">
                <p>{lesson.startTime}</p>
                <p className="text-xs">{lesson.endTime}</p>
              </div>
              <div className="min-w-0 flex-1">
                {chip === null ? null : (
                  <p className="mb-1">
                    <span className={chip === 'now' ? NOW_CHIP : NEXT_CHIP}>
                      {chip === 'now' ? 'Сейчас' : 'Далее'}
                    </span>
                  </p>
                )}
                <p className={`text-sm font-medium text-text ${cancelled === true ? 'line-through decoration-2' : ''}`}>
                  {lesson.subjectName}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {lesson.typeLabel} · {lesson.room}
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}

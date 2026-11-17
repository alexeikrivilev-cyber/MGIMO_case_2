/**
 * Форматирование дат и чисел для кабинета.
 *
 * Два разных правила — намеренно:
 * - даты @db.Date (расписание, отметки о болезни, часы приёма) хранятся
 *   полночь UTC и форматируются UTC-геттерами: сдвиг часового пояса не
 *   должен переносить пару на соседний день;
 * - даты-время (уведомления, заявки, решения по верификации) хранят
 *   момент и форматируются локальными геттерами: «14:05» должно быть
 *   локальным временем пользователя.
 *
 * Функции чистые и детерминированы — их проверяют тесты страниц.
 */

const MONTHS_GENITIVE: readonly string[] = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const WEEKDAYS_SHORT: readonly string[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Полночь UTC — граница «календарного дня» для @db.Date. */
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** «сегодня» / «завтра» / «17 ноября» (с годом, если он не текущий). */
export function formatDayLabel(date: Date, now: Date = new Date()): string {
  const day = utcDay(date);
  const today = utcDay(now);
  const diffDays = Math.round((day.getTime() - today.getTime()) / MS_PER_DAY);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'завтра';
  if (diffDays === -1) return 'вчера';

  const sameYear = day.getUTCFullYear() === today.getUTCFullYear();
  const base = `${day.getUTCDate()} ${MONTHS_GENITIVE[day.getUTCMonth()] ?? ''}`.trim();
  return sameYear ? base : `${base} ${day.getUTCFullYear()}`;
}

/** «17 ноября» для календарного дня (@db.Date). */
export function formatDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()] ?? ''}`.trim();
}

/** «Пн» — короткая метка дня недели (1 — понедельник). */
export function weekdayShort(weekday: number): string {
  return WEEKDAYS_SHORT[weekday - 1] ?? '';
}

/** «17 ноября 2026» для дня (@db.Date). */
export function formatDateWithYear(date: Date): string {
  return `${formatDate(date)} ${date.getUTCFullYear()}`;
}

/** Диапазон дней: «17 — 20 ноября 2026» или «17 ноября — 3 декабря 2026». */
export function formatDateRange(from: Date, to: Date): string {
  if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${from.getUTCDate()} — ${to.getUTCDate()} ${MONTHS_GENITIVE[to.getUTCMonth()] ?? ''} ${to.getUTCFullYear()}`.trim();
  }
  return `${formatDateWithYear(from)} — ${formatDateWithYear(to)}`;
}

/** «17 ноября, 14:05» — для момента события (локальное время). */
export function formatMoment(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()] ?? ''}, ${hours}:${minutes}`;
}

/** Длительность в минутах → «1 ч 20 мин» / «45 мин». */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** Средний балл с русской запятой: 4.35 → «4,35». */
export function formatScore(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(2).replace('.', ',');
}

/** Оценка/дельба с русской запятой и знаком: 0.08 → «+0,08». */
export function formatDelta(value: number | null): string {
  if (value === null) return '—';
  const fixed = Math.abs(value).toFixed(2).replace('.', ',');
  if (value > 0) return `+${fixed}`;
  if (value < 0) return `−${fixed}`;
  return fixed;
}

/** Размер файла: «820 Б», «12 КБ», «1,4 МБ» (списки планов и фото). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} КБ`;
  }
  return `${(kilobytes / 1024).toFixed(1).replace('.', ',')} МБ`;
}

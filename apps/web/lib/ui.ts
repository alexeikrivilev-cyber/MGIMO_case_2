/**
 * Общие UI-константы кабинета.
 *
 * Зачем отдельный модуль: строки классов повторялись в трёх экранах
 * (FOCUS_RING) и в восьми (текстовые ссылки). Дура блирование констант —
 * прямой путь к расхождению: одна копия получит исправление, остальные нет.
 *
 * TEXT_LINK_CLASS решает конкретную проблему WCAG 2.2 AA (2.5.8 Target Size
 * Minimum): интерактивный элемент обязан иметь Hit-область не меньше 24×24
 * CSS-пикселя. Текстовая ссылка `text-sm` имеет естественную высоту ~17px —
 * этого недостаточно. `py-1` добавляет 8px по вертикали (17+8=25px), не меняя
 * видимый размер шрифта и не ломая перенос строк внутри абзаца (ссылка
 * остаётся инлайновой).
 *
 * Проверено прогоном в браузере на 360px: все ссылки кабинета >= 24px.
 */
/** Видимое кольцо фокуса — обязательное требование WCAG 2.4.7. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Отклик на нажатие (артефакт docs/design/ui-alive-wave-1.html, §2):
 * масштаб 0.96 за 150ms ease-out под prefers-reduced-motion: no-preference
 * (motion-safe), disabled никогда не масштабируется (enabled:). Переход —
 * только именованные свойства, никогда all. Под reduce масштаба нет
 * (глобальное правило globals.css гасит длительности), остаётся цвет.
 */
export const PRESS_FEEDBACK =
  'transition-[transform,background-color,border-color,color] ' +
  'duration-[var(--udgu-motion-duration-fast)] ' +
  'ease-[var(--udgu-motion-ease-out)] ' +
  'motion-safe:enabled:active:scale-[0.96]';

/**
 * Текстовая ссылка внутри контента: Hit-область >= 24px (WCAG 2.2 AA, 2.5.8).
 * Использовать ВМЕСТО голого `text-primary underline decoration-dotted`.
 */
export const TEXT_LINK_CLASS = `font-medium text-primary underline decoration-dotted py-1 ${FOCUS_RING}`;

/** Ссылка-действие мелким шрифтом (в шапках карточек). */
export const TEXT_LINK_SM_CLASS = `text-sm font-medium text-primary underline decoration-dotted py-1 ${FOCUS_RING}`;

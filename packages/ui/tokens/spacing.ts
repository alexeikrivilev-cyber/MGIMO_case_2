/**
 * Токены геометрии @horizon/ui: отступы, радиусы, тени, длительности и кривые анимаций.
 *
 * Отступы — 4-based (шаг 4px). Радиусы — «округлые формы» визуальной направленности.
 * Тени — мягкие, с лёгким индиго-оттенком; для тёмной темы переопределяются
 * в tokens/theme.css (более глубокие, плотные).
 *
 * Префикс CSS-переменных — `--hz-space-*`, `--hz-radius-*`, `--hz-shadow-*`,
 * `--hz-duration-*`, `--hz-ease-*`.
 */

import { token } from "./colors.ts";
import type { Token } from "./colors.ts";

/** Шкала отступов, 4-based (rem). */
export const spacing = {
  0: token("0rem", "dimension", "0px"),
  1: token("0.25rem", "dimension", "4px — микро-отступы, иконки в кнопках"),
  2: token("0.5rem", "dimension", "8px — плотные внутренние отступы"),
  3: token("0.75rem", "dimension", "12px — отступы внутри карточек"),
  4: token("1rem", "dimension", "16px — базовый отступ, поля ввода"),
  5: token("1.25rem", "dimension", "20px"),
  6: token("1.5rem", "dimension", "24px — отступы между блоками"),
  8: token("2rem", "dimension", "32px — отступы секций"),
  10: token("2.5rem", "dimension", "40px"),
  12: token("3rem", "dimension", "48px — крупные разделители"),
  16: token("4rem", "dimension", "64px — вертикальные ритмы страницы"),
  20: token("5rem", "dimension", "80px"),
  24: token("6rem", "dimension", "96px — Hero-отступы"),
} as const;

/** Радиусы скругления. */
export const radius = {
  sm: token("0.375rem", "dimension", "6px — мелкие элементы, чипы"),
  md: token("0.625rem", "dimension", "10px — кнопки, поля ввода"),
  lg: token("0.875rem", "dimension", "14px — карточки, панели"),
  xl: token("1.25rem", "dimension", "20px — модальные окна, нижние листы"),
  full: token("9999px", "dimension", "Полное скругление — аватары, бейджи-точки"),
} as const;

/** Тени Elevation 1..3 (светлая тема; тёмная тема — в theme.css). */
export const shadow = {
  1: token(
    "0 1px 2px 0 rgb(15 23 42 / 0.05), 0 1px 3px 0 rgb(15 23 42 / 0.08)",
    "shadow",
    "Elevation 1 — карточки в потоке",
  ),
  2: token(
    "0 2px 4px -1px rgb(15 23 42 / 0.05), 0 4px 12px -2px rgb(15 23 42 / 0.08)",
    "shadow",
    "Elevation 2 — выпадающие меню, залипшие элементы",
  ),
  3: token(
    "0 4px 8px -2px rgb(15 23 42 / 0.06), 0 12px 28px -4px rgb(15 23 42 / 0.12)",
    "shadow",
    "Elevation 3 — модальные окна, оверлеи",
  ),
} as const;

/** Длительности анимаций. */
export const duration = {
  instant: token("0ms", "duration", "Мгновенно — без анимации"),
  fast: token("100ms", "duration", "Hover, микро-взаимодействия"),
  base: token("150ms", "duration", "Базовый переход состояний"),
  slow: token("200ms", "duration", "Появление элементов, аккордеоны"),
  slower: token("300ms", "duration", "Модальные окна, смена маршрутов"),
} as const;

/** Кривые замедления (Material-style easing). */
export const easing = {
  standard: token("cubic-bezier(0.2, 0, 0, 1)", "cubicBezier", "Стандартная кривая"),
  entrance: token("cubic-bezier(0, 0, 0.2, 1)", "cubicBezier", "Вход элемента"),
  exit: token("cubic-bezier(0.4, 0, 1, 1)", "cubicBezier", "Выход элемента"),
} as const;

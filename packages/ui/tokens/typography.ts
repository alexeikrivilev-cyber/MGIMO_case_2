/**
 * Типографические токены @horizon/ui.
 *
 * Мобильный-first: база 16px, модульная шкала ~1.25 (major third).
 * Шаг за базой: 20px → 25px → 31.25px ≈ 32px → 39px ≈ 40px.
 * Значения размеров заданы в rem (относительно корневого 16px),
 * line-height — безразмерный (коэффициент), чтобы не зависеть от единиц.
 *
 * Префикс CSS-переменных — `--hz-font-*`, `--hz-text-*`.
 */

import { token } from "./colors.ts";
import type { Token } from "./colors.ts";

/** Системный стек — только системные шрифты, без загрузок со сторонних CDN. */
export const fontFamily = {
  sans: token(
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    "fontFamily",
    "Системный стек для интерфейса",
  ),
  mono: token(
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    "fontFamily",
    "Системный моноширинный стек (коды, номера зачёток)",
  ),
} as const;

/** Веса начертаний. */
export const fontWeight = {
  regular: token(400, "fontWeight", "Обычный — основной текст"),
  medium: token(500, "fontWeight", "Средний — подписи, caption, кнопки"),
  semibold: token(600, "fontWeight", "Полужирный — заголовки, кнопки"),
  bold: token(700, "fontWeight", "Жирный — display, акценты"),
} as const;

/** Размеры шрифты (мобильные значения, rem). */
export const fontSize = {
  display: token("2.125rem", "dimension", "34px — hero-заголовки, крупные цифры"),
  h1: token("1.75rem", "dimension", "28px — заголовок страницы"),
  h2: token("1.5rem", "dimension", "24px — заголовок секции"),
  h3: token("1.25rem", "dimension", "20px — заголовок карточки"),
  body: token("1rem", "dimension", "16px — основной текст"),
  bodySm: token("0.875rem", "dimension", "14px — плотный текст, списки"),
  caption: token("0.75rem", "dimension", "12px — подписи, бейджи, метаданные"),
  button: token("1rem", "dimension", "16px — текст кнопок"),
} as const;

/** Межстрочные интервалы (безразмерные коэффициенты). */
export const lineHeight = {
  display: token(1.15, "number", "Плотный ведущий для крупного текста"),
  h1: token(1.2, "number"),
  h2: token(1.3, "number"),
  h3: token(1.35, "number"),
  body: token(1.5, "number", "Комфортное чтение длинного текста"),
  bodySm: token(1.45, "number"),
  caption: token(1.4, "number"),
  button: token(1.25, "number"),
} as const;

/** Трекинг (letter-spacing). */
export const letterSpacing = {
  display: token("-0.02em", "dimension", "Уплотнение крупных заголовков"),
  h1: token("-0.015em", "dimension"),
  h2: token("-0.01em", "dimension"),
  h3: token("0em", "dimension"),
  body: token("0em", "dimension"),
  bodySm: token("0em", "dimension"),
  caption: token("0.01em", "dimension", "Разрежение мелкого текста"),
  button: token("0.01em", "dimension"),
} as const;

export type TextStyleName = keyof typeof fontSize;

/** Готовые текстовые стили — размер + вес + leading + трекинг. */
export const textStyles = {
  display: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.display,
  },
  h1: {
    fontSize: fontSize.h1,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.h1,
    letterSpacing: letterSpacing.h1,
  },
  h2: {
    fontSize: fontSize.h2,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.h2,
    letterSpacing: letterSpacing.h2,
  },
  h3: {
    fontSize: fontSize.h3,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.h3,
    letterSpacing: letterSpacing.h3,
  },
  body: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.body,
    letterSpacing: letterSpacing.body,
  },
  bodySm: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.bodySm,
    letterSpacing: letterSpacing.bodySm,
  },
  caption: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.caption,
    letterSpacing: letterSpacing.caption,
  },
  button: {
    fontSize: fontSize.button,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.button,
    letterSpacing: letterSpacing.button,
  },
} as const satisfies Record<TextStyleName, Record<string, Token<string> | Token<number>>>;

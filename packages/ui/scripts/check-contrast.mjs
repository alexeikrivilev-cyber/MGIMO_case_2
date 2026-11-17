#!/usr/bin/env node
/**
 * Проверка контраста токенов @horizon/ui по WCAG 2.2 AA.
 *
 * Скрипт парсит tokens/theme.css (источник истины для рантайма), резолвит
 * var()-ссылки и проверяет пары «текст → фон» (>= 4.5:1) и «граница → фон»
 * для интерактивных контролов (>= 3:1, WCAG 1.4.11).
 *
 * Запуск: npm run check:contrast (из packages/ui).
 * Ненулевой код выхода — хотя бы одна пара не проходит.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(join(here, "tokens", "theme.css"), "utf8");

/** Достаёт содержимое CSS-блока по селектору (с балансировкой скобок). */
function extractBlock(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Блок не найден в theme.css: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(open + 1, i);
}

function parseVars(block) {
  const vars = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block)) !== null) vars[m[1]] = m[2].trim();
  return vars;
}

function resolveVar(value, vars, depth = 0) {
  if (depth > 10) throw new Error(`Слишком глубокая var()-ссылка: ${value}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    const next = vars[name.slice(2)];
    if (next === undefined) throw new Error(`Неизвестная переменная ${name} в "${value}"`);
    return resolveVar(next, vars, depth + 1);
  });
}

function toRgb(hex) {
  let h = hex.trim();
  if (!h.startsWith("#")) throw new Error(`Ожидался #hex, получено: ${hex}`);
  h = h.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6) throw new Error(`Ожидался #rrggbb, получено: ${hex}`);
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgHex, bgHex) {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Пары «текст → фон»: минимум 4.5:1. */
const textPairs = [
  ["text-primary", "surface"],
  ["text-primary", "surface-raised"],
  ["text-primary", "surface-sunken"],
  ["text-secondary", "surface"],
  ["text-secondary", "surface-raised"],
  ["text-tertiary", "surface"],
  ["text-tertiary", "surface-raised"],
  ["brand", "surface"],
  ["brand", "surface-raised"],
  ["link", "surface-raised"],
  ["text-inverse", "brand"],
  ["success", "surface"],
  ["success", "success-subtle"],
  ["warning", "surface"],
  ["warning", "warning-subtle"],
  ["danger", "surface"],
  ["danger", "danger-subtle"],
  ["info", "surface"],
  ["info", "info-subtle"],
  ["button-primary-text", "button-primary-bg"],
  ["button-primary-text", "button-primary-bg-hover"],
  ["button-secondary-text", "button-secondary-bg"],
  ["button-secondary-text", "button-secondary-bg-hover"],
  ["button-ghost-text", "surface"],
  ["button-ghost-text", "button-ghost-bg-hover"],
  ["button-danger-text", "button-danger-bg"],
  ["button-danger-text", "button-danger-bg-hover"],
  ["input-text", "input-bg"],
  ["input-placeholder", "input-bg"],
  ["nav-text", "nav-bg"],
  ["nav-text-active", "nav-bg"],
  ["nav-text-active", "nav-active-bg"],
  ["badge-neutral-text", "badge-neutral-bg"],
  ["badge-success-text", "badge-success-bg"],
  ["badge-warning-text", "badge-warning-bg"],
  ["badge-danger-text", "badge-danger-bg"],
  ["badge-info-text", "badge-info-bg"],
  ["state-selected-text", "state-selected-bg"],
];

/** Границы интерактивных контролов: минимум 3:1 (WCAG 1.4.11). */
const nonTextPairs = [
  ["input-border", "input-bg"],
  ["input-border-hover", "input-bg"],
  ["input-border-focus", "input-bg"],
  ["input-border-error", "input-bg"],
  ["focus-ring", "surface"],
  ["focus-ring", "surface-raised"],
  ["button-secondary-border", "surface"],
  ["button-secondary-border", "button-secondary-bg"],
];

const themes = [
  { name: "light", vars: parseVars(extractBlock(":root {")) },
  { name: "dark", vars: parseVars(extractBlock('[data-theme="dark"] {')) },
];

let failed = 0;

for (const theme of themes) {
  const rows = [];
  for (const [fg, bg] of textPairs) {
    const ratio = contrast(resolveVar(`var(--hz-${fg})`, theme.vars), resolveVar(`var(--hz-${bg})`, theme.vars));
    const ok = ratio >= 4.5;
    if (!ok) failed += 1;
    rows.push({ kind: "text", fg, bg, ratio, min: 4.5, ok });
  }
  for (const [fg, bg] of nonTextPairs) {
    const ratio = contrast(resolveVar(`var(--hz-${fg})`, theme.vars), resolveVar(`var(--hz-${bg})`, theme.vars));
    const ok = ratio >= 3;
    if (!ok) failed += 1;
    rows.push({ kind: "ui", fg, bg, ratio, min: 3, ok });
  }

  console.log(`\n=== Тема: ${theme.name} ===`);
  for (const r of rows) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(
      `  [${status}] ${r.kind.padEnd(4)} ${r.fg.padEnd(28)} on ${r.bg.padEnd(26)} ${r.ratio.toFixed(2)}:1 (min ${r.min})`,
    );
  }
}

console.log(
  failed === 0
    ? `\nВсе пары проходят WCAG 2.2 AA (${themes.length * (textPairs.length + nonTextPairs.length)} проверок).`
    : `\n${failed} пар(ы) не проходят. Исправьте токены в tokens/theme.css и tokens/colors.ts.`,
);

process.exit(failed === 0 ? 0 : 1);

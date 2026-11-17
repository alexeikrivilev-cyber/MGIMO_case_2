#!/usr/bin/env node
/**
 * Проверка паритета tokens/theme.css и TS-токенов (tokens/colors.ts).
 *
 * Каждый semantic- и component-токен из colors.ts должен существовать
 * в theme.css как --hz-<kebab-case> с тем же значением, в обеих темах.
 * Защищает от дрейфа между рантайм-CSS и TS-определениями.
 *
 * Запуск: npm run check:parity (из packages/ui).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { semantic, component } from "../src/index.ts";

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

const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const themes = [
  { name: "light", vars: parseVars(extractBlock(":root {")) },
  { name: "dark", vars: parseVars(extractBlock('[data-theme="dark"] {')) },
];

let problems = 0;
let checked = 0;

for (const theme of themes) {
  const tokens = { ...semantic[theme.name], ...component[theme.name] };
  for (const [name, tok] of Object.entries(tokens)) {
    checked += 1;
    const key = `hz-${kebab(name)}`;
    const cssValue = theme.vars[key];
    if (cssValue === undefined) {
      problems += 1;
      console.log(`  [MISSING] ${theme.name}: --${key} отсутствует в theme.css`);
    } else if (cssValue.toLowerCase() !== tok.$value.toLowerCase()) {
      problems += 1;
      console.log(
        `  [DRIFT] ${theme.name}: --${key} = ${cssValue}, а в colors.ts = ${tok.$value}`,
      );
    }
  }
}

console.log(
  problems === 0
    ? `Паритет CSS ↔ TS: OK (${checked} токенов в двух темах).`
    : `${problems} расхождений. Синхронизируйте tokens/theme.css и tokens/colors.ts.`,
);

process.exit(problems === 0 ? 0 : 1);

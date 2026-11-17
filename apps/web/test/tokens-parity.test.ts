/**
 * ТЕСТ ПАРИТЕТА ТОКЕНОВ: packages/ui/src/tokens.ts ↔ packages/ui/tokens.css.
 *
 * Токены — единственный источник цвета/отступов/типографики, и они
 * продублированы в двух местах: CSS-переменные (--udgu-*) использует
 * Tailwind-слой (@theme inline), объект tokens — серверные расчёты и
 * пропсы компонентов. Расхождение молча ломает контракт: интерфейс
 * рисует одно, а логика считает другое.
 *
 * Тест требует: КАЖДОЕ значение из tokens.ts присутствует в tokens.css
 * под тем же именем и с тем же значением. Плюс обратная проверка для
 * цветовых переменных (в CSS не появилась переменная без TS-пары) и
 * инвариант «системная тёмная тема == принудительная .dark» (иначе
 * пользователь с ночным режимом ОС увидит другую палитру).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '@udgu/ui';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const tokensCssPath = path.resolve(testDir, '../../../packages/ui/tokens.css');

// ---------------------------------------------------------------------------
// Разбор CSS
// ---------------------------------------------------------------------------

/** Блоки переменных tokens.css по селектору. */
interface CssBlocks {
  /** :root — светлая тема (по умолчанию в CSS). */
  readonly root: Map<string, string>;
  /** .dark — принудительная тёмная тема (класс на <html>). */
  readonly dark: Map<string, string>;
  /** Медиазапрос prefers-color-scheme: dark — системная тёмная тема. */
  readonly systemDark: Map<string, string>;
}

function parseCssVariables(css: string): CssBlocks {
  // Комментарии CSS убираем заранее: иначе они попадают в текст селектора
  // (например, "/* тема */ .dark") и блок перестаёт опознаваться.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Регулярка ловит внутренние блоки без вложенных фигурных скобок:
  // для @media предваряющий текст — это селектор вложенного правила.
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  const root = new Map<string, string>();
  const dark = new Map<string, string>();
  const systemDark = new Map<string, string>();

  const declarationPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;

  for (const [, selectorRaw, body] of withoutComments.matchAll(blockPattern)) {
    const selector = selectorRaw.trim();
    const target =
      selector === ':root' ? root : selector === '.dark' ? dark : selector.includes(':root:not(') ? systemDark : null;
    if (target === null) {
      continue;
    }
    for (const [, name, value] of body.matchAll(declarationPattern)) {
      if (name !== undefined && value !== undefined) {
        target.set(name, value.trim());
      }
    }
  }

  return { root, dark, systemDark };
}

const css = readFileSync(tokensCssPath, 'utf8');
const blocks = parseCssVariables(css);

// ---------------------------------------------------------------------------
// Соответствие имён: tokens.ts → CSS-переменная
// ---------------------------------------------------------------------------

/** Группа tokens.ts → префикс CSS-переменной. */
const GROUP_TO_CSS_PREFIX: Readonly<Record<string, string>> = {
  color: 'color',
  colorDark: 'color',
  space: 'space',
  radius: 'radius',
  shadow: 'shadow',
  font: 'font',
  text: 'text',
  leading: 'leading',
  fontWeight: 'font',
  breakpoint: 'breakpoint',
  transition: 'transition',
  z: 'z',
};

/** camelCase и цифры → kebab-case: surface2 → surface-2, textMuted → text-muted. */
function kebabCase(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

/** CSS-имя переменной для значения токена. */
function cssVariableName(group: string, key: string): string {
  const prefix = GROUP_TO_CSS_PREFIX[group];
  assert.ok(prefix !== undefined, `группа ${group} не описана в GROUP_TO_CSS_PREFIX`);
  return `--udgu-${prefix}-${kebabCase(key)}`;
}

/** Все пары «CSS-имя → значение» из tokens.ts с указанием блока темы. */
function collectTokenEntries(): readonly { readonly name: string; readonly value: string; readonly block: 'root' | 'dark'; readonly source: string }[] {
  const entries: { name: string; value: string; block: 'root' | 'dark'; source: string }[] = [];
  for (const [group, values] of Object.entries(tokens)) {
    for (const [key, value] of Object.entries(values)) {
      entries.push({
        name: cssVariableName(group, key),
        value: typeof value === 'string' ? value : String(value),
        block: group === 'colorDark' ? 'dark' : 'root',
        source: `${group}.${key}`,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Тесты
// ---------------------------------------------------------------------------

test('tokens.css разобран: найдены блоки :root, .dark и системной тёмной темы', () => {
  // :root — вся палитра (16 цветов + отступы, радиусы, тени, типографика…).
  // .dark и медиазапрос — 16 цветов + 3 тени тёмной темы.
  assert.ok(blocks.root.size >= 40, `в :root ожидалось ≥40 переменных, найдено ${blocks.root.size}`);
  assert.ok(blocks.dark.size >= 19, `в .dark ожидалось ≥19 переменных, найдено ${blocks.dark.size}`);
  assert.ok(
    blocks.systemDark.size >= 19,
    `в медиазапросе тёмной темы ожидалось ≥19 переменных, найдено ${blocks.systemDark.size}`,
  );
  assert.match(css, /--udgu-color-bg:\s*#f6f7f9;/, 'светлый bg на месте');
});

test('паритет: каждое значение tokens.ts есть в tokens.css с тем же значением', () => {
  const entries = collectTokenEntries();
  assert.ok(entries.length >= 60, `ожидалось ≥60 значений токенов, получено ${entries.length}`);

  const mismatches: string[] = [];
  for (const entry of entries) {
    const block = entry.block === 'dark' ? blocks.dark : blocks.root;
    const cssValue = block.get(entry.name);
    if (cssValue === undefined) {
      mismatches.push(`${entry.source}: в tokens.css нет переменной ${entry.name}`);
      continue;
    }
    if (cssValue !== entry.value) {
      mismatches.push(`${entry.source}: tokens.ts = ${entry.value!}, tokens.css ${entry.name} = ${cssValue}`);
    }
  }

  assert.deepEqual(mismatches, [], 'значения токенов разошлись между tokens.ts и tokens.css');
});

test('паритет цветов: в tokens.css нет цветовой переменной без пары в tokens.ts', () => {
  const entries = collectTokenEntries();
  const rootNames = new Set(entries.filter((entry) => entry.block === 'root').map((entry) => entry.name));
  const darkNames = new Set(entries.filter((entry) => entry.block === 'dark').map((entry) => entry.name));

  const problems: string[] = [];
  for (const [name] of blocks.root) {
    if (name.startsWith('--udgu-color-') && !rootNames.has(name)) {
      problems.push(`tokens.css :root: ${name} без пары в tokens.color`);
    }
  }
  for (const [name] of blocks.dark) {
    if (name.startsWith('--udgu-color-') && !darkNames.has(name)) {
      problems.push(`tokens.css .dark: ${name} без пары в tokens.colorDark`);
    }
  }

  assert.deepEqual(problems, [], 'цветовые переменные CSS без пары в tokens.ts');
});

test('тёмная тема: системная настройка и класс .dark дают одну палитру', () => {
  const differences: string[] = [];
  for (const [name, value] of blocks.dark) {
    const systemValue = blocks.systemDark.get(name);
    if (systemValue === undefined) {
      differences.push(`${name}: есть в .dark, отсутствует в prefers-color-scheme`);
      continue;
    }
    if (systemValue !== value) {
      differences.push(`${name}: .dark = ${value}, prefers-color-scheme = ${systemValue}`);
    }
  }
  assert.deepEqual(differences, [], 'принудительная и системная тёмная темы разошлись');
});

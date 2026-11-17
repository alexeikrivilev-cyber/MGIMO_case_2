/**
 * ТЕСТ КОНТРАСТА ТОКЕНОВ (WCAG 2.2 AA, прототип «Цифровой деканат»).
 *
 * Считает WCAG-контраст (относительная яркость, формула 1.4.3) для всех
 * пар «текст → поверхность», которые реально встречаются в кабинете, —
 * в СВЕТЛОЙ и в ТЁМНОЙ теме (тёмная — по умолчанию, решение Council).
 *
 * Пороги:
 * - обычный текст (< 18.66 px без полужирности / < 24 px) — 4.5:1;
 * - крупный текст и UI-границы (индикатор фокуса) — 3:1.
 *
 * Все проверяемые паси — текст на поверхности, поэтому порог 4.5:1.
 * Пара primary/surface закрывает сразу два требования: ссылка текстом
 * (4.5:1) и кольцо фокуса focus-visible (3:1, WCAG 2.4.11/1.4.11).
 *
 * Если пара не проходит — чиним ТОКЕНЫ (packages/ui/tokens.css и
 * packages/ui/src/tokens.ts одновременно), а не порог теста.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from '@udgu/ui';

// ---------------------------------------------------------------------------
// Математика WCAG
// ---------------------------------------------------------------------------

/** sRGB-канал → линейная светимость (формула WCAG 2.x). */
function channelLuminance(value8bit: number): number {
  const channel = value8bit / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость цвета #rrggbb (0…1). */
function relativeLuminance(hex: string): number {
  const digits = hex.replace('#', '');
  assert.equal(digits.length, 6, `ожидался цвет #rrggbb, получено ${hex}`);
  const [r, g, b] = [0, 2, 4].map((offset) => channelLuminance(Number.parseInt(digits.slice(offset, offset + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** Коэффициент контраста двух цветов #rrggbb (1…21). */
function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Контракт контраста: пары токенов и где они встречаются в интерфейсе
// ---------------------------------------------------------------------------

/** Минимальный порог для пар со «средним» размером текста — 4.5:1. */
const TEXT_CONTRAST = 4.5;

/** Ключ цвета в tokens.color / tokens.colorDark. */
type ColorKey = keyof typeof tokens.color;

/** Палитра темы как обычные строки (tokens описан через `as const`). */
type ColorPalette = Readonly<Record<ColorKey, string>>;

interface ContrastPair {
  /** Ключ цвета текста в tokens.color / tokens.colorDark. */
  readonly foreground: ColorKey;
  /** Ключ цвета поверхности в tokens.color / tokens.colorDark. */
  readonly background: ColorKey;
  /** Где эта пара встречается в кабинете (для сообщения об ошибке). */
  readonly usedIn: string;
}

const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { foreground: 'text', background: 'surface', usedIn: 'основной текст на карточках' },
  { foreground: 'text', background: 'bg', usedIn: 'основной текст на фоне страницы' },
  { foreground: 'text', background: 'surface2', usedIn: 'текст на вторичных поверхностях (сводка, подсказки)' },
  { foreground: 'textMuted', background: 'surface', usedIn: 'второстепенный текст на карточках' },
  { foreground: 'textMuted', background: 'bg', usedIn: 'второстепенный текст на фоне страницы' },
  { foreground: 'textMuted', background: 'surface2', usedIn: 'пояснения на вторичных поверхностях' },
  { foreground: 'onPrimary', background: 'primary', usedIn: 'подпись на primary-кнопке' },
  { foreground: 'onPrimary', background: 'danger', usedIn: 'подпись на danger-кнопке' },
  { foreground: 'primary', background: 'surface', usedIn: 'ссылки текстом + кольцо фокуса' },
  { foreground: 'primary', background: 'bg', usedIn: 'ссылки текстом на фоне страницы' },
  { foreground: 'primary', background: 'primarySoft', usedIn: 'бейдж статуса «информация»' },
  { foreground: 'success', background: 'successSoft', usedIn: 'бейдж «Зачтено»' },
  { foreground: 'danger', background: 'dangerSoft', usedIn: 'ошибки форм и бейджи ошибок' },
  { foreground: 'warning', background: 'warningSoft', usedIn: 'баннер концепта и предупреждения' },
];

interface ThemeCase {
  readonly name: string;
  readonly palette: ColorPalette;
}

const THEMES: readonly ThemeCase[] = [
  { name: 'светлая', palette: tokens.color },
  { name: 'тёмная (по умолчанию)', palette: tokens.colorDark },
];

// ---------------------------------------------------------------------------
// Тесты
// ---------------------------------------------------------------------------

test('контракт токенов покрывает все заявленные пары', () => {
  assert.ok(CONTRAST_PAIRS.length >= 12, 'в контракте должны быть все пары интерфейса');
  for (const theme of THEMES) {
    for (const pair of CONTRAST_PAIRS) {
      const foreground = theme.palette[pair.foreground];
      const background = theme.palette[pair.background];
      assert.match(foreground, /^#[0-9a-f]{6}$/, `${theme.name}: ${pair.foreground} — не цвет #rrggbb`);
      assert.match(background, /^#[0-9a-f]{6}$/, `${theme.name}: ${pair.background} — не цвет #rrggbb`);
    }
  }
});

for (const theme of THEMES) {
  test(`контраст WCAG AA: ${theme.name} тема`, () => {
    const rows: string[] = [];
    const failures: string[] = [];

    for (const pair of CONTRAST_PAIRS) {
      const foreground = theme.palette[pair.foreground];
      const background = theme.palette[pair.background];
      const ratio = contrastRatio(foreground, background);
      const rounded = Math.round(ratio * 100) / 100;
      rows.push(
        `${`${pair.foreground}/${pair.background}`.padEnd(26)} ${String(rounded).padStart(6)}:1  (${pair.usedIn})`,
      );
      if (ratio < TEXT_CONTRAST) {
        failures.push(
          `${pair.foreground} (${foreground}) на ${pair.background} (${background}) — ${rounded}:1, ` +
            `требуется ${TEXT_CONTRAST}:1 (${pair.usedIn})`,
        );
      }
    }

    console.log(`\nКонтраст, ${theme.name} тема (порог ${TEXT_CONTRAST}:1):\n${rows.join('\n')}\n`);
    assert.deepEqual(failures, [], `пары токенов не проходят WCAG AA в ${theme.name} теме`);
  });
}

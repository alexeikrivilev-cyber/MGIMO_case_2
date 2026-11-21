/**
 * СТОРОЖ ХАРАКТЕРА ПУСТЫХ СОСТОЯНИЙ (волна 5 «оживления»,
 * docs/design/ui-alive-wave-5.html).
 *
 * ЗАЧЕМ: пустое состояние кабинета — заголовок + пояснение + действие, и
 * всё. Директива владельца: «пустые состояния с характером через иконку
 * (не текст)». Поэтому КАЖДОЕ использование <EmptyState> получает icon=
 * с иконкой своего раздела (IconCalendar у расписания, IconRequests у
 * заявок, IconBell у уведомлений…). Иконки — из components/icons.tsx:
 * они декоративны (aria-hidden), поэтому текст не дублируется.
 *
 * ПОЧЕМУ СТОРОГ ПО ИСХОДНИКАМ, А НЕ ПО РЕНДЕРУ: 29 сайтов в 21 экране,
 * часть из них живёт за гейтами ролей и в клиентских островах — рендером
 * каждый не достать. Страж по тексту ловит КЛАСС: новый экран с пустым
 * состоянием без иконки роняет прогон сразу.
 *
 * ПРАВИЛО: в JSX каждого <EmptyState> (до закрывающего `/>` или `>`)
 * присутствует `icon=`. Исключений нет: смысловая иконка есть у всех 17
 * иконок кабинета, «своей» нет только у совсем нового раздела — там
 * ближайшая по смыслу (правило волны 5).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Исходник, попавший в обход. */
interface SourceFile {
  /** Путь от корня apps/web — в таком виде файл называется в отчёте. */
  readonly relPath: string;
  readonly text: string;
}

/** Все .tsx исходники приложения (без тестов, сборки и зависимостей). */
function sources(dir: string, relDir: string, found: SourceFile[] = []): readonly SourceFile[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') {
      continue;
    }
    const full = join(dir, entry);
    const relPath = relDir === '' ? entry : `${relDir}/${entry}`;
    if (statSync(full).isDirectory()) {
      sources(full, relPath, found);
    } else if (entry.endsWith('.tsx')) {
      found.push({ relPath, text: readFileSync(full, 'utf8') });
    }
  }
  return found;
}

/** Номер строки (с 1), в которой лежит индекс. */
function lineAt(text: string, index: number): number {
  let line = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i += 1) {
    if (text.charAt(i) === '\n') {
      line += 1;
    }
  }
  return line;
}

/**
 * Открывающий тег от `<EmptyState` до его закрытия: `/>` (самозакрытие)
 * или `>` (у тега есть дети). Внутри фигурных скобок и строковых
 * литералов `>` не считается: в `action={<LinkButton href="/x">…}` уголок
 * принадлежит вложенному JSX, а не концу тега EmptyState.
 */
function openingTag(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const ch = source.charAt(i);
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
      }
      continue;
    }
    if (depth > 0) {
      continue;
    }
    if (ch === '/' && source.charAt(i + 1) === '>') {
      return source.slice(from, i + 2);
    }
    if (ch === '>') {
      return source.slice(from, i + 1);
    }
  }
  // Незакрытый тег (битый файл): отдаём остаток — лучше лишний шанс
  // поймать сайт без иконки, чем пропустить его.
  return source.slice(from);
}

/** Сайты `<EmptyState` без `icon=` в открывающем теге: «файл:строка». */
function findIconlessEmptyStates(files: readonly SourceFile[]): readonly string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(/<EmptyState\b/g)) {
      const tag = openingTag(file.text, match.index ?? 0);
      if (!tag.includes('icon=')) {
        found.push(`${file.relPath}:${lineAt(file.text, match.index ?? 0)}`);
      }
    }
  }
  return found;
}

const appFiles = sources(WEB_DIR, '').filter((file) => !file.relPath.startsWith('test/'));

test('пустые состояния: каждое несёт иконку раздела (волна 5)', () => {
  assert.ok(appFiles.length > 30, `исходники приложения найдены (${appFiles.length})`);

  const iconless = findIconlessEmptyStates(appFiles);
  assert.deepEqual(
    iconless,
    [],
    `сайты <EmptyState> без icon= — пустые состояния без характера (волна 5):\n${iconless.join('\n')}`,
  );
});

test('обход исходников: сторож действительно видит пустые состояния', () => {
  // Страховка от пустого гарда: если обход сломается (сменится структура
  // каталогов, корень определится не там), тест выше стал бы зелёным по
  // причине «нечего проверять», а не «проверили». Здесь проверяем, что
  // детектор живёт на НАСТОЯЩИМ коде: дашборд несёт пять пустых состояний,
  // и все пять — с иконкой.
  const paths = appFiles.map((file) => file.relPath);
  assert.ok(
    paths.some((relPath) => relPath.endsWith('app/(cabinet)/dashboard-screen.tsx')),
    'обход включает экраны кабинета',
  );
  assert.ok(
    paths.some((relPath) => relPath.endsWith('components/ui.tsx')),
    'обход включает компоненты',
  );

  const dashboard = appFiles.find((file) => file.relPath.endsWith('app/(cabinet)/dashboard-screen.tsx'));
  const sites = [...(dashboard?.text ?? '').matchAll(/<EmptyState\b/g)];
  assert.equal(sites.length, 5, `на дашборде пять пустых состояний, найдено ${sites.length}`);
  assert.deepEqual(
    findIconlessEmptyStates(dashboard === undefined ? [] : [dashboard]),
    [],
    'все пустые состояния дашборда несут иконку',
  );
});

test('самопроверка детектора: сайт без иконки ловится, с иконкой — проходит', () => {
  // Зелёные проверки выше ничего не значат, если сам детектор сломан.
  // Прогоняем его по синтетическим образцам: сайт без icon= обязан
  // находиться, сайт с icon= — проходить.

  const withoutIcon = findIconlessEmptyStates([
    { relPath: '<synthetic>', text: 'const x = (\n  <Card>\n    <EmptyState title="Пусто" />\n  </Card>\n);\n' },
  ]);
  assert.equal(withoutIcon.length, 1, 'детектор ловит сайт без иконки');
  assert.match(withoutIcon[0] ?? '', /<synthetic>:3/, 'в отчёте — файл и строка сайта');

  const withIcon = findIconlessEmptyStates([
    {
      relPath: '<synthetic>',
      text: 'const x = (\n  <Card>\n    <EmptyState title="Пусто" icon={<IconCalendar />} />\n  </Card>\n);\n',
    },
  ]);
  assert.deepEqual(withIcon, [], 'сайт с иконкой проходит');

  // Многострочный тег с action: `>` внутри выражения не должен обрезать
  // тег раньше времени — иначе детектор «увидел» бы icon= там, где его нет.
  const multiline = [
    '<EmptyState',
    '  title="Заявок нет"',
    '  action={<LinkButton href="/requests?new=1">Подать заявку</LinkButton>}',
    '/>',
  ].join('\n');
  assert.equal(
    findIconlessEmptyStates([{ relPath: '<synthetic>', text: multiline }]).length,
    1,
    'детектор видит отсутствие иконки в многострочном теге с action',
  );

  const multilineOk = [
    '<EmptyState',
    '  title="Заявок нет"',
    '  icon={<IconRequests />}',
    '  action={<LinkButton href="/requests?new=1">Подать заявку</LinkButton>}',
    '/>',
  ].join('\n');
  assert.deepEqual(
    findIconlessEmptyStates([{ relPath: '<synthetic>', text: multilineOk }]),
    [],
    'многострочный тег с иконкой проходит',
  );

  // Тег с детьми (не самозакрытие): правила те же.
  const withChildren = '<EmptyState title="Пусто">\n  <p>пояснение</p>\n</EmptyState>';
  assert.equal(
    findIconlessEmptyStates([{ relPath: '<synthetic>', text: withChildren }]).length,
    1,
    'тег с детьми без иконки ловится',
  );
});

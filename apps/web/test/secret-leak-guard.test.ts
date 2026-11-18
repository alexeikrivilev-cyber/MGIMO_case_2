/**
 * РЕГРЕССИОННЫЙ ГАРД ПРОТИВ УТЕЧКИ СЕКРЕТОВ (этап P4).
 *
 * Предыстория: в проекте уже был дефект — строка подключения DATABASE_URL
 * С ПАРОЛЕМ уходила в stderr при инициализации. Сейчас утечки в коде нет,
 * но «сейчас нет» ничего не гарантирует: следующая правка диагностики
 * («давайте посмотрим, какая строка подключения не подхватилась») вернёт
 * её обратно, и заметит это не тест, а тот, кто читает чужие логи.
 *
 * Поэтому здесь стоит сторож: он проходит ВЕСЬ исходный код репозитория
 * на каждом прогоне npm test и падает на первой утечке. Дешевле, чем
 * разбор инцидента, и работает без человека.
 *
 * Что проверяется (каждый пункт — отдельный кейс):
 *   1. ЛОГИ-С-СЕКРЕТАМИ: ни один вызов console.* и ни один
 *      process.stderr/stdout.write не получает ЗНАЧЕНИЕ чувствительной
 *      переменной окружения (DATABASE_URL, *TOKEN*, *KEY*, *PASSWORD*,
 *      *SECRET*, *CREDENTIAL*). Имя переменной строкой упомянуть можно
 *      ('DATABASE_URL не задан') — это нормальная диагностика.
 *   2. СТРОКИ-ПОДКЛЮЧЕНИЯ: в исходниках нет postgres://user:password@host
 *      с настоящим (не заглушечным) паролем.
 *   3. GITIGNORE: .env перечислен явно — файлы окружения не индексируются.
 *   4. ОТСЛЕЖИВАЕМЫЕ-СЕКРЕТЫ: git ls-files не содержит .env, *.pem, *.key,
 *      *.p12, id_rsa*.
 *
 * Плюс самопроверка детектора на синтетических образцах: сторож, который
 * молча проходит из-за ошибки в своей регулярке, хуже отсутствия сторожа.
 *
 * Известное ограничение: гард текстовый, без разбора потока данных. Прямое
 * обращение process.env.СЕКРЕТ внутри вызова лога он ловит; передачу
 * секрета через промежуточную переменную (const dsn = process.env.X;
 * console.error(dsn)) — нет. Это осознанный размен: текстовый сторож
 * покрывает исторический дефект и типичную правку диагностики, не требуя
 * парсера и не падая от ложных срабатываний.
 *
 * Границы сторожа: только чтение файлов и один вызов git — без сети, без
 * БД, детерминированно и быстро (порядок обхода сортируется).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/web/test → корень монорепо это три уровня вверх.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------------------
// Обход исходников
// ---------------------------------------------------------------------------

/** Исходник, попавший в обход. */
interface SourceFile {
  /** Путь от корня репозитория — в таком виде файл называется в отчёте. */
  readonly relPath: string;
  readonly text: string;
}

/** Расширения, которые мы считаем исходным кодом. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);

/**
 * Каталоги вне обхода. node_modules/.next/dist/coverage/.git — зависимости
 * и артефакты сборки: править их бессмысленно, а объём огромный.
 * storage — приватное хранилище фото студбилетов: это пользовательские
 * данные, а не код, и сканировать их незачем.
 */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', 'dist', 'coverage', '.git', 'storage']);

/** Сгенерированный Prisma-клиент: его пишет кодогенератор, не человек. */
const EXCLUDED_DIR_PATHS = new Set(['packages/db/src/generated']);

/**
 * Файлы .env* в обход не попадают сами: их расширение не входит в
 * SOURCE_EXTENSIONS. Это принципиально — содержимое .env это и есть
 * секреты, сканировать его нечего.
 */
function collectSources(dir: string, relDir: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name) || EXCLUDED_DIR_PATHS.has(relPath)) {
        continue;
      }
      collectSources(path.join(dir, entry.name), relPath, out);
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    out.push({ relPath, text: readFileSync(path.join(dir, entry.name), 'utf8') });
  }
}

/** Все исходники репозитория, отсортированные по пути (детерминизм). */
function readAllSources(): readonly SourceFile[] {
  const files: SourceFile[] = [];
  collectSources(repoRoot, '', files);
  return files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Маска строк и комментариев
// ---------------------------------------------------------------------------

/**
 * Возвращает исходник той же длины, где содержимое строковых литералов,
 * шаблонных литералов и комментариев заменено пробелами (переводы строк
 * сохранены — номера строк не съезжают). Выражения `${...}` внутри
 * шаблонов сохраняются: именно туда подставляется значение переменной.
 *
 * ЗАЧЕМ: проверка «в аргументах вызова лога» должна смотреть на КОД, а не
 * на текст. Иначе сторож сходит с ума на литералах — например, в
 * apps/mcp-server/test/stdio.test.ts внутри строки лежит тело
 * скрипта-пробы (process.stdout.write(process.env.DATABASE_URL ===
 * undefined ? ...)), который печатает только ФАКТ загрузки, а не значение.
 * Настоящая утечка всегда выглядит как обращение к process.env в позиции
 * выражения, и маска её не прячет.
 *
 * Известное ограничение: литералы регулярок с escaped-слэшами (/\/\//)
 * могут «съесть» хвост своей строки. Это ведёт только к пропуску
 * подозрительного места на этой строке, но не к ложной тревоге.
 */
function maskLiterals(source: string): string {
  const chars = source.split('');
  const blank = (index: number): void => {
    if (chars[index] !== '\n') {
      chars[index] = ' ';
    }
  };

  // Стек контекстов: код и шаблонный литерал. Внутри `${...}` снова
  // работаем как в коде (там может быть вложенный шаблон), поэтому
  // вложенность держим стеком, а не флагом.
  interface Frame {
    readonly kind: 'code' | 'template';
    /** Глубина фигурных скобок текущего ${...}. */
    braces: number;
  }
  const stack: Frame[] = [{ kind: 'code', braces: 0 }];

  let i = 0;
  while (i < source.length) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) {
      break;
    }
    const ch = source.charAt(i);

    if (frame.kind === 'template') {
      if (ch === '\\') {
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (ch === '`') {
        blank(i);
        stack.pop();
        i += 1;
      } else if (ch === '$' && source.charAt(i + 1) === '{') {
        // Интерполяция: сами `${` оставляем видимыми и уходим в код.
        stack.push({ kind: 'code', braces: 0 });
        i += 2;
      } else {
        blank(i);
        i += 1;
      }
      continue;
    }

    // Режим кода.
    if (ch === '/' && source.charAt(i + 1) === '/') {
      while (i < source.length && source.charAt(i) !== '\n') {
        blank(i);
        i += 1;
      }
      continue;
    }
    if (ch === '/' && source.charAt(i + 1) === '*') {
      while (i < source.length && !(source.charAt(i) === '*' && source.charAt(i + 1) === '/')) {
        blank(i);
        i += 1;
      }
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      blank(i);
      i += 1;
      while (i < source.length) {
        const inner = source.charAt(i);
        if (inner === '\\') {
          blank(i);
          blank(i + 1);
          i += 2;
          continue;
        }
        blank(i);
        i += 1;
        // Закрывающая кавычка или перевод строки (незакрытый литерал —
        // не повод глотать остаток файла).
        if (inner === quote || inner === '\n') {
          break;
        }
      }
      continue;
    }
    if (ch === '`') {
      blank(i);
      stack.push({ kind: 'template', braces: 0 });
      i += 1;
      continue;
    }
    if (ch === '{') {
      if (stack.length > 1) {
        frame.braces += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (stack.length > 1 && frame.braces > 0) {
        frame.braces -= 1;
      } else if (stack.length > 1) {
        // Закрыли ${...}: возвращаемся в шаблонный литерал.
        stack.pop();
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  return chars.join('');
}

// ---------------------------------------------------------------------------
// Мелочи для отчётов
// ---------------------------------------------------------------------------

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

/** Текст строки из ИСХОДНОГО (немаскированного) файла, усечённый. */
function lineText(source: string, index: number): string {
  const from = source.lastIndexOf('\n', Math.max(index - 1, 0)) + 1;
  const to = source.indexOf('\n', index);
  const line = source.slice(from, to === -1 ? source.length : to).trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

// ---------------------------------------------------------------------------
// Проверка 1: логи со значением чувствительной переменной
// ---------------------------------------------------------------------------

/**
 * Части имён переменных, ЗНАЧЕНИЕ которых нельзя печатать. Имя считается
 * чувствительным, если содержит любую из них (без учёта регистра):
 * DATABASE_URL, MCP_SESSION_TOKEN, TELEGRAM_BOT_TOKEN,
 * ASSISTANT_LLM_API_KEY, POSTGRES_PASSWORD.
 */
const SENSITIVE_ENV_PARTS = ['DATABASE_URL', 'TOKEN', 'KEY', 'PASSWORD', 'SECRET', 'CREDENTIAL'];

function isSensitiveEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return SENSITIVE_ENV_PARTS.some((part) => upper.includes(part));
}

/** Начало вызова лога: console.error/warn/log/info/debug и запись в потоки. */
const LOG_CALL_PATTERN = /(?:console\.(?:error|warn|log|info|debug)|process\.(?:stderr|stdout)\.write)\s*\(/g;

/** Обращение к значению переменной окружения: process.env.ИМЯ. */
const ENV_REFERENCE_PATTERN = /process\.env\.([A-Z0-9_]+)/gi;

/**
 * Конец вызова: парная закрывающая скобка. Вызов может быть многострочным
 * (console.warn(\n  `...`,\n)), поэтому ищем балансировкой скобок, а не
 * до конца строки.
 */
function callEnd(masked: string, openParen: number): number {
  let depth = 1;
  for (let i = openParen + 1; i < masked.length; i += 1) {
    const ch = masked.charAt(i);
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  // Незакрытый вызов (битый файл): смотрим до конца, лучше лишний шанс
  // поймать утечку, чем пропустить её.
  return masked.length;
}

/** Утечка в логе: файл, строка, переменная, фрагмент кода. */
interface SecretLogCall {
  readonly relPath: string;
  readonly line: number;
  readonly variable: string;
  readonly fragment: string;
}

function findSecretLogCalls(file: SourceFile): readonly SecretLogCall[] {
  const masked = maskLiterals(file.text);
  const found: SecretLogCall[] = [];

  for (const call of masked.matchAll(LOG_CALL_PATTERN)) {
    const openParen = call.index + call[0].length - 1;
    const args = masked.slice(openParen + 1, callEnd(masked, openParen));

    for (const reference of args.matchAll(ENV_REFERENCE_PATTERN)) {
      const name = reference[1] ?? '';
      if (!isSensitiveEnvName(name)) {
        continue;
      }
      found.push({
        relPath: file.relPath,
        line: lineAt(masked, call.index),
        variable: name,
        fragment: lineText(file.text, call.index),
      });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Проверка 2: строка подключения с настоящим паролем
// ---------------------------------------------------------------------------

/**
 * Строка подключения PostgreSQL со встроенным паролем.
 * Второй группой забираем пароль: он не должен содержать пробелы, '@',
 * '/' и ':' — иначе регулярка вылезла бы за границы пароля.
 */
const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/([^\s:/@]+):([^\s@]*)@/gi;

/**
 * Пароли-заглушки. Это НЕ секреты, а общеизвестные значения для локальной
 * разработки и примеров (.env.example и тестовые фикстуры используют
 * postgres:***@localhost и postgres:postgres@localhost). Настоящий пароль
 * такой строкой не выглядит — он случаен и в словаре не находится.
 *
 * ЗАЧЕМ исключение: без него сторож кричал бы на каждую фикстуру тестовой
 * базы, и его отключили бы первым же коммитом. Цена решения — пароль,
 * который РОВНО совпадает со словарём-заглушкой (скажем, 'postgres'),
 * гард не заметит; всё остальное он ловит.
 */
const PLACEHOLDER_PASSWORDS = new Set([
  '',
  '***',
  'postgres',
  'user',
  'pass',
  'password',
  'changeme',
  'example',
  'test',
  'secret',
  'your-password',
]);

function isPlaceholderPassword(password: string): boolean {
  // ${VAR}, <пароль> — значение подставится из окружения, в коде его нет.
  if (/[$<{]/.test(password)) {
    return true;
  }
  return PLACEHOLDER_PASSWORDS.has(password.toLowerCase());
}

interface CommittedPassword {
  readonly relPath: string;
  readonly line: number;
  readonly password: string;
  readonly fragment: string;
}

/**
 * ВАЖНО: в отличие от проверки логов, маска литералов здесь НЕ применяется.
 * Зафиксированная в репозитории строка подключения — это всегда строковый
 * литерал; замаскировать его значит перестать проверять главное.
 */
function findCommittedPasswords(file: SourceFile): readonly CommittedPassword[] {
  const found: CommittedPassword[] = [];

  for (const match of file.text.matchAll(CONNECTION_STRING_PATTERN)) {
    const password = match[2] ?? '';
    if (isPlaceholderPassword(password)) {
      continue;
    }
    found.push({
      relPath: file.relPath,
      line: lineAt(file.text, match.index ?? 0),
      password,
      fragment: lineText(file.text, match.index ?? 0),
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// Проверки
// ---------------------------------------------------------------------------

const sources = readAllSources();

test('обход исходников: сторож действительно видит код репозитория', () => {
  // Страховка от пустого гарда: если обход сломается (сменится структура
  // каталогов, корень определится не там), тесты ниже стали бы зелёными
  // по причине «нечего проверять», а не «проверили».
  assert.ok(sources.length > 100, `ожидалось больше 100 исходников, найдено ${sources.length}`);
  const paths = new Set(sources.map((file) => file.relPath));
  assert.ok(paths.has('apps/web/app/api/health/route.ts'), 'обход включает apps/web');
  assert.ok(paths.has('packages/core/src/bot/outbox.ts'), 'обход включает packages/core');
  assert.ok(paths.has('apps/mcp-server/src/stdio.ts'), 'обход включает apps/mcp-server');
  assert.ok(paths.has('packages/db/prisma/seed.ts'), 'обход включает packages/db');
  // Тестовые файлы в обходе: утечка в фикстуре — такая же утечка.
  assert.ok(paths.has('apps/web/test/helpers.ts'), 'обход включает тестовые файлы');
  // Исключения работают.
  assert.ok(!paths.has('packages/db/src/generated/client.ts'), 'сгенерированный Prisma-клиент вне обхода');
  assert.ok(
    ![...paths].some((relPath) => relPath.startsWith('storage/')),
    'приватное хранилище storage/ вне обхода',
  );
});

test('логи: ни один вызов console.* и process.std*.write не печатает значение секрета', () => {
  const leaks = sources.flatMap((file) => findSecretLogCalls(file));

  assert.deepEqual(
    leaks.map((leak) => `${leak.relPath}:${leak.line} — ${leak.variable}: ${leak.fragment}`),
    [],
    'в аргументах логов нет значений чувствительных переменных окружения',
  );
});

test('строки подключения: в исходниках нет пароля БД в открытом виде', () => {
  const committed = sources.flatMap((file) => findCommittedPasswords(file));

  assert.deepEqual(
    committed.map((item) => `${item.relPath}:${item.line} — пароль «${item.password}»: ${item.fragment}`),
    [],
    'в исходниках нет postgres://user:password@host с настоящим паролем',
  );
});

test('.gitignore: файлы окружения не попадают в индекс', () => {
  // .env в индексе = пароль в истории git навсегда, даже после удаления.
  const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  const lines = gitignore.split('\n').map((line) => line.trim());
  assert.ok(
    lines.includes('.env') || lines.includes('/.env'),
    'в корневом .gitignore должна быть строка .env',
  );
});

test('git: отслеживаемые файлы — ни .env, ни ключей', (t) => {
  let tracked: string[];
  try {
    // git может отсутствовать в окружении (собранный образ без git) —
    // тогда проверку нечего выполнять, но и падать не на что.
    const output = execSync('git rev-parse --is-inside-work-tree', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    assert.equal(output, 'true');
    tracked = execSync('git ls-files -z', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter((entry) => entry !== '');
  } catch {
    // Причина пропуска: без git нельзя спросить индекс, а догадываться
    // по рабочему каталогу нельзя — .env на диске может быть просто
    // неотслеживаемым (и это правильно).
    t.skip('git недоступен в этом окружении — проверить индекс нечем');
    return;
  }

  // Ровно те образцы, которые нельзя держать в репозитории. .env.example
  // не подпадает: имя не равно .env, а точка в конце не делает его ключом.
  const secretPatterns: readonly RegExp[] = [/^\.env$/, /\.pem$/i, /\.key$/i, /\.p12$/i, /^id_rsa/];

  const secrets = tracked
    .map((relPath) => ({ relPath, name: path.basename(relPath) }))
    .filter((file) => secretPatterns.some((pattern) => pattern.test(file.name)))
    .map((file) => file.relPath);

  assert.deepEqual(secrets, [], 'в индексе git нет файлов окружения и ключей');
});

test('самопроверка детектора: сторож умеет ловить утечку, а не только молчать', () => {
  // Зелёные проверки выше ничего не значат, если сами детекторы сломаны.
  // Здесь они прогоняются по синтетическим образцам: утечка обязана
  // находиться, допустимый код — обязаны проходить.

  const leakyLogs: readonly string[] = [
    // Значение строки подключения в stderr — ровно тот дефект, что уже был.
    "console.error('инициализация БД', process.env.DATABASE_URL);",
    // Многострочный вызов с шаблоном: балансировка скобок должна дойти до конца.
    'console.warn(\n  `[mcp] сессия ${process.env.MCP_SESSION_TOKEN} не принята`,\n);',
    // Запись сразу в поток.
    "process.stderr.write(`key=${process.env.ASSISTANT_LLM_API_KEY}\\n`);",
    // Обращение к значению в выражении, а не в литерале.
    "console.log('dsn:', process.env.POSTGRES_PASSWORD ?? 'нет');",
  ];
  for (const sample of leakyLogs) {
    const found = findSecretLogCalls({ relPath: '<synthetic>', text: sample });
    assert.equal(found.length, 1, `детектор логов должен поймать: ${sample}`);
  }

  const cleanLogs: readonly string[] = [
    // Упоминание ИМЕНИ переменной — допустимая диагностика.
    "console.error('DATABASE_URL не задан');",
    "console.warn(`[bot] интервал ${interval} мс`);",
    // Несекретная переменная.
    "console.log(`NEXT_PUBLIC_APP_NAME=${process.env.NEXT_PUBLIC_APP_NAME}`);",
  ];
  for (const sample of cleanLogs) {
    assert.deepEqual(
      findSecretLogCalls({ relPath: '<synthetic>', text: sample }),
      [],
      `детектор логов не должен срабатывать на: ${sample}`,
    );
  }

  // Настоящий пароль в строке подключения — находим. Пароль собран из
  // кусков: иначе в самом файле сторожа лежала бы готовая строка
  // подключения с паролем, и гард поймал бы собственный тест.
  const realPassword = ['x8K', 'd9f2', 'aQw'].join('');
  const committed = findCommittedPasswords({
    relPath: '<synthetic>',
    text: `const url = 'postgresql://udgu:${realPassword}@db.prod:5432/udgu';`,
  });
  assert.equal(committed.length, 1, 'детектор строк подключения должен поймать настоящий пароль');
  assert.equal(committed[0]?.password, realPassword);

  // Заглушки и пустой пароль — проходят.
  const allowed: readonly string[] = [
    "const a = 'postgres:***@localhost:5432/udgu';",
    "const b = 'postgresql://postgres:postgres@localhost:5432/horizon_test?schema=public';",
    'const c = `postgresql://${user}:${password}@${host}/db`;',
    "const d = 'postgres://postgres:@localhost:5432/udgu';",
  ];
  for (const sample of allowed) {
    assert.deepEqual(
      findCommittedPasswords({ relPath: '<synthetic>', text: sample }),
      [],
      `детектор строк подключения не должен срабатывать на: ${sample}`,
    );
  }
});

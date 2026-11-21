/**
 * РЕГРЕССИОННЫЙ ГАРД: чтение файлов приватного хранилища в сервисах
 * ядра (волна 6).
 *
 * Предыстория: два дефекта одного класса. Строка учебного плана есть в
 * БД, а файл в хранилище пропал → наружу летит IdCardStorageError
 * NOT_FOUND, слой API превращает её в 400 «Файл не принят: проверьте
 * формат (JPEG, PNG или WebP)» — преподаватель получает нонсенс-ошибку
 * про загрузку файла, хотя ничего не загружал. То же с фото студбилета
 * в кабинете сотрудника деканата.
 *
 * Оба места исправлены (studyPlan.ts, staffVerifications.ts), но
 * «сейчас исправлено» ничего не гарантирует: следующая правка сервиса
 * («давайте просто прочитаем файл») вернёт дефект, и заметит это не
 * тест, а пользователь, получивший ошибку про чужое действие.
 *
 * Поэтому здесь стоит сторож: он читает ВСЕ исходники services/*.ts и
 * требует, чтобы каждое обращение к чтению файла из приватного
 * хранилища (readStudyPlan / readIdCardPhoto / readSickLeaveCertificate)
 * было обёрнуто в try с обработкой ошибки хранилища. Иначе регрессия
 * вернёт «проверьте формат» вместо честного ответа.
 *
 * Плюс самопроверка детектора на синтетических образцах (как в
 * apps/web/test/secret-leak-guard.test.ts): сторож, который молча
 * проходит из-за ошибки в собственной логике, хуже отсутствия сторожа.
 *
 * Границы сторожа: только чтение файлов — без сети, без БД,
 * детерминированно и быстро.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// packages/core/test → packages/core/src/services
const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/services');

/** Подпись файла в отчёте — путь от корня монорепо. */
const SERVICES_PREFIX = 'packages/core/src/services/';

/**
 * Чтения приватного хранилища, ошибка которых не должна уходить наверх
 * как «плохой файл от клиента»: файл уже был принят, его читают по
 * пути из БД.
 */
const GUARDED_READS = ['readStudyPlan', 'readIdCardPhoto', 'readSickLeaveCertificate'] as const;

/** Вызов чтения: `await readX(` (пробелы и переводы строк допустимы). */
const READ_CALL_PATTERN = new RegExp(`await\\s+(?:${GUARDED_READS.join('|')})\\s*\\(`, 'g');

/** Сколько символов ДО вызова смотрим на незакрытый `try {`. */
const LOOK_BEHIND = 400;

/** Сколько символов ПОСЛЕ вызова ищем `catch`. */
const LOOK_AHEAD = 800;

// ---------------------------------------------------------------------------
// Обход исходников
// ---------------------------------------------------------------------------

/** Исходник сервиса, попавший в обход. */
interface ServiceFile {
  /** Путь от корня монорепо — в таком виде файл называется в отчёте. */
  readonly relPath: string;
  readonly text: string;
}

/** Исходники services/*.ts, отсортированные по имени (детерминизм). */
const serviceFiles: readonly ServiceFile[] = await (async () => {
  const names = await readdir(servicesDir);
  const files: ServiceFile[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.ts')).sort()) {
    files.push({
      relPath: `${SERVICES_PREFIX}${name}`,
      text: await readFile(path.join(servicesDir, name), 'utf8'),
    });
  }
  return files;
})();

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

// ---------------------------------------------------------------------------
// Детектор: вызов чтения обёрнут в try с обработкой ошибки?
// ---------------------------------------------------------------------------

/**
 * Защищено ли чтение, начинающееся с индекса callIndex.
 *
 * Признак защиты — ДВА условия вместе:
 * 1. до вызова (в пределах LOOK_BEHIND символов) есть `try {`, и между
 *    ним и вызовом нет `}` — значит вызов ещё внутри этого блока;
 * 2. после вызова (в пределах LOOK_AHEAD символов) есть `catch` —
 *    значит ошибка хранилища обрабатывается, а не уходит наверх.
 *
 * ЗАЧЕМ оба: голый `try {` без `catch` после вызова — это чужой блок
 * (например, обёртка вокруг вызова сервиса целиком), а `catch` без
 * незакрытого `try {` до вызова — блок, который уже закрылся.
 */
function isGuarded(source: string, callIndex: number): boolean {
  const before = source.slice(Math.max(0, callIndex - LOOK_BEHIND), callIndex);
  const tryStart = before.lastIndexOf('try {');
  if (tryStart === -1) {
    return false;
  }
  // Между `try {` и вызовом не должно быть закрывающей скобки блока:
  // иначе вызов находится уже за пределами этого try.
  if (before.slice(tryStart + 'try {'.length).includes('}')) {
    return false;
  }
  const after = source.slice(callIndex, callIndex + LOOK_AHEAD);
  return after.includes('catch');
}

/** Незащищённое чтение: файл, строка вызова и фрагмент кода. */
interface UnguardedRead {
  readonly relPath: string;
  readonly line: number;
  readonly fragment: string;
}

function findUnguardedReads(file: ServiceFile): readonly UnguardedRead[] {
  const found: UnguardedRead[] = [];
  for (const match of file.text.matchAll(READ_CALL_PATTERN)) {
    const callIndex = match.index ?? 0;
    if (isGuarded(file.text, callIndex)) {
      continue;
    }
    const line = file.text.slice(file.text.lastIndexOf('\n', Math.max(callIndex - 1, 0)) + 1, callIndex);
    found.push({
      relPath: file.relPath,
      line: lineAt(file.text, callIndex),
      fragment: line.trim().slice(0, 120),
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Проверки
// ---------------------------------------------------------------------------

test('обход исходников: сторож действительно видит сервисы ядра', () => {
  // Страховка от пустого гарда: если обход сломается (сменится структура
  // каталогов, корень определится не там), проверка ниже стала бы
  // зелёной по причине «нечего проверять», а не «проверили».
  assert.ok(serviceFiles.length >= 10, `ожидалось не меньше 10 сервисов, найдено ${serviceFiles.length}`);
  const paths = new Set(serviceFiles.map((file) => file.relPath));
  assert.ok(paths.has(`${SERVICES_PREFIX}studyPlan.ts`), 'обход включает studyPlan.ts');
  assert.ok(paths.has(`${SERVICES_PREFIX}staffVerifications.ts`), 'обход включает staffVerifications.ts');
  assert.ok(paths.has(`${SERVICES_PREFIX}schedule.ts`), 'обход включает schedule.ts');
  assert.ok(
    paths.has(`${SERVICES_PREFIX}staff-scope.ts`),
    'обход включает вспомогательные модули сервисов',
  );
});

test('чтение приватного хранилища обёрнуто в try с обработкой ошибки', () => {
  const unguarded = serviceFiles.flatMap((file) => findUnguardedReads(file));

  assert.deepEqual(
    unguarded.map((item) => `${item.relPath}:${item.line} — ${item.fragment}`),
    [],
    'каждое чтение файла из хранилища защищено: иначе ошибка хранилища уйдёт клиенту как «проверьте формат»',
  );
});

test('самопроверка детектора: незащищённое чтение находится, защищённое — нет', () => {
  // Зелёная проверка выше ничего не значит, если сам детектор сломан.
  // Здесь он прогоняется по синтетическим образцам: незащищённое чтение
  // обязательно находится, защищённое — обязательно проходит.

  const UNGUARDED = 'const buffer = await readIdCardPhoto(pathValue);\nreturn buffer;\n';
  const GUARDED =
    'try {\n  const buffer = await readIdCardPhoto(pathValue);\n} catch (error) {\n  if (error instanceof IdCardStorageError) throw new ValidationError("NOT_FOUND", "x");\n  throw error;\n}\n';
  // try-блок уже закрылся до вызова: защитой он не является, даже если
  // где-то дальше в файле есть catch.
  const AFTER_CLOSED_TRY =
    'try {\n  const other = 1;\n} catch {\n  log(other);\n}\nconst buffer = await readIdCardPhoto(pathValue);\n';

  for (const sample of [UNGUARDED, AFTER_CLOSED_TRY]) {
    assert.equal(
      isGuarded(sample, sample.indexOf('readIdCardPhoto(')),
      false,
      `сторож замечает незащищённое чтение: ${JSON.stringify(sample)}`,
    );
  }
  assert.equal(isGuarded(GUARDED, GUARDED.indexOf('readIdCardPhoto(')), true, 'защищённое чтение проходит');
});

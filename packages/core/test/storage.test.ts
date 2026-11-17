/**
 * Юнит-тесты приватного хранилища фото студбилетов.
 *
 * Проверяем валидацию (MIME, размер), изоляцию каталогов и, главное,
 * защиту от выхода за пределы storage/id-cards (path traversal).
 * Тесты работают во временном каталоге через STORAGE_DIR — реальное
 * хранилище репозитория не трогается.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveIdCardPhoto,
  readIdCardPhoto,
  deleteIdCardPhoto,
  idCardPhotoRelativePath,
  idCardRoot,
  storageRoot,
  IdCardStorageError,
  ID_CARD_DIR_NAME,
  MAX_ID_CARD_SIZE_BYTES,
} from '../src/index.js';

const STUDENT_ID = '8f14e45f-ceea-467a-9f0b-3f1d6b2c7a11';
const OTHER_STUDENT_ID = '2c9d1f00-11aa-4bb3-8c4d-5e6f708192a3';

/** Минимальный валидный JPEG (SOI + EOI). */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

let storageDir: string;
let previousStorageDir: string | undefined;

test.before(async () => {
  previousStorageDir = process.env.STORAGE_DIR;
  storageDir = await mkdtemp(join(tmpdir(), 'udgu-id-cards-'));
  process.env.STORAGE_DIR = storageDir;
});

test.after(async () => {
  if (previousStorageDir === undefined) {
    delete process.env.STORAGE_DIR;
  } else {
    process.env.STORAGE_DIR = previousStorageDir;
  }
  await rm(storageDir, { recursive: true, force: true });
});

async function catchStorageError(promise: Promise<unknown>): Promise<IdCardStorageError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof IdCardStorageError, `ожидалась IdCardStorageError, получено: ${String(error)}`);
    return error;
  }
  throw new Error('ожидалась ошибка IdCardStorageError, но вызов завершился успешно');
}

test('STORAGE_DIR переопределяет корень хранилища', () => {
  assert.equal(storageRoot(), storageDir);
  assert.equal(idCardRoot(), join(storageDir, ID_CARD_DIR_NAME));
});

test('сохранение фото создаёт каталог студента и возвращает относительный путь', async () => {
  const relativePath = await saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/jpeg');

  assert.match(relativePath, /^id-cards\/8f14e45f-ceea-467a-9f0b-3f1d6b2c7a11\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(idCardPhotoRelativePath(STUDENT_ID, 'photo.png'), `id-cards/${STUDENT_ID}/photo.png`);

  const stored = await stat(join(idCardRoot(), STUDENT_ID));
  assert.ok(stored.isDirectory(), 'каталог студента создан');

  const readBack = await readIdCardPhoto(relativePath);
  assert.deepEqual(readBack, JPEG_BYTES, 'содержимое файла совпадает с сохранённым');
});

test('сохранённые файлы разных студентов не пересекаются', async () => {
  const first = await saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/jpeg');
  const second = await saveIdCardPhoto(OTHER_STUDENT_ID, JPEG_BYTES, 'image/png');

  assert.notEqual(first, second);
  assert.ok(first.startsWith(`id-cards/${STUDENT_ID}/`));
  assert.ok(second.startsWith(`id-cards/${OTHER_STUDENT_ID}/`));

  const firstBytes = await readIdCardPhoto(first);
  const secondBytes = await readIdCardPhoto(second);
  assert.deepEqual(firstBytes, JPEG_BYTES);
  assert.deepEqual(secondBytes, JPEG_BYTES);
});

test('допустимые MIME: jpeg, png, webp; расширение соответствует типу', async () => {
  const jpeg = await saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/jpeg');
  const png = await saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/png');
  const webp = await saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/webp');

  assert.ok(jpeg.endsWith('.jpg'));
  assert.ok(png.endsWith('.png'));
  assert.ok(webp.endsWith('.webp'));
});

test('недопустимый MIME отклоняется', async () => {
  const error = await catchStorageError(saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/gif'));
  assert.equal(error.code, 'INVALID_MIME');
  assert.match(error.message, /image\/gif/);

  const svg = await catchStorageError(saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/svg+xml'));
  assert.equal(svg.code, 'INVALID_MIME');

  const pdf = await catchStorageError(saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'application/pdf'));
  assert.equal(pdf.code, 'INVALID_MIME');
});

test('файл больше 5 МБ отклоняется, файл ровно 5 МБ проходит', async () => {
  const tooBig = Buffer.alloc(MAX_ID_CARD_SIZE_BYTES + 1, 0x41);
  const error = await catchStorageError(saveIdCardPhoto(STUDENT_ID, tooBig, 'image/jpeg'));
  assert.equal(error.code, 'FILE_TOO_LARGE');
  assert.match(error.message, /лимит/);

  const atLimit = Buffer.alloc(MAX_ID_CARD_SIZE_BYTES, 0x41);
  const relativePath = await saveIdCardPhoto(STUDENT_ID, atLimit, 'image/jpeg');
  const readBack = await readIdCardPhoto(relativePath);
  assert.equal(readBack.byteLength, MAX_ID_CARD_SIZE_BYTES);
});

test('пустой буфер отклоняется', async () => {
  const error = await catchStorageError(saveIdCardPhoto(STUDENT_ID, Buffer.alloc(0), 'image/jpeg'));
  assert.equal(error.code, 'FILE_TOO_LARGE');
});

test('некорректный идентификатор студента отклоняется', async () => {
  for (const badId of ['', '   ', '../../etc', 'a/b', '..', 'student?1']) {
    const error = await catchStorageError(saveIdCardPhoto(badId, JPEG_BYTES, 'image/jpeg'));
    assert.equal(error.code, 'INVALID_PATH', `идентификатор "${badId}" должен быть отклонён`);
  }
});

test('path traversal: явный выход за пределы каталога отклоняется', async () => {
  const error = await catchStorageError(readIdCardPhoto('../../../etc/passwd'));
  assert.equal(error.code, 'INVALID_PATH');
  assert.match(error.message, /пределы/);

  const nested = await catchStorageError(
    readIdCardPhoto(`id-cards/${STUDENT_ID}/../../../../etc/passwd`),
  );
  assert.equal(nested.code, 'INVALID_PATH');

  const parentEscape = await catchStorageError(readIdCardPhoto(`id-cards/../../secret.txt`));
  assert.equal(parentEscape.code, 'INVALID_PATH');

  const deleteAttack = await catchStorageError(deleteIdCardPhoto('../../../etc/passwd'));
  assert.equal(deleteAttack.code, 'INVALID_PATH');

  const saveAttack = await catchStorageError(
    saveIdCardPhoto('../../etc', JPEG_BYTES, 'image/jpeg'),
  );
  assert.equal(saveAttack.code, 'INVALID_PATH');
});

test('path traversal: абсолютные пути вне хранилища отклоняются', async () => {
  const absolute = await catchStorageError(readIdCardPhoto('/etc/passwd'));
  assert.equal(absolute.code, 'INVALID_PATH');

  const sibling = await catchStorageError(readIdCardPhoto(join(storageDir, 'secret.txt')));
  assert.equal(sibling.code, 'INVALID_PATH');

  const outsideRoot = await catchStorageError(readIdCardPhoto(join(storageDir, '..', 'outside.txt')));
  assert.equal(outsideRoot.code, 'INVALID_PATH');
});

test('path traversal: закодированные и экзотические пути не отдают чужие файлы', async () => {
  const secret = await readFile('/etc/passwd');
  const attacks = [
    `id-cards/${STUDENT_ID}/..%2f..%2fetc/passwd`,
    `id-cards/${STUDENT_ID}/..\\..\\etc\\passwd`,
    'id-cards//....//etc/passwd',
  ];

  for (const attack of attacks) {
    const error = await catchStorageError(readIdCardPhoto(attack));
    assert.ok(
      error.code === 'INVALID_PATH' || error.code === 'NOT_FOUND',
      `путь "${attack}" обработан как ошибка хранилища (${error.code})`,
    );
  }

  // Ни один вариант не возвращает содержимое файла вне хранилища.
  for (const attack of attacks) {
    try {
      const leaked = await readIdCardPhoto(attack);
      assert.notDeepEqual(leaked, secret, `путь "${attack}" не должен отдавать /etc/passwd`);
    } catch {
      // Ошибка хранилища — это ожидаемое поведение.
    }
  }
});

test('чтение несуществующего файла даёт NOT_FOUND', async () => {
  const missing = await catchStorageError(
    readIdCardPhoto(idCardPhotoRelativePath(STUDENT_ID, '00000000-0000-4000-8000-000000000000.jpg')),
  );
  assert.equal(missing.code, 'NOT_FOUND');
});

test('пустой путь и путь на каталог отклоняются', async () => {
  const empty = await catchStorageError(readIdCardPhoto(''));
  assert.equal(empty.code, 'INVALID_PATH');

  const spaces = await catchStorageError(readIdCardPhoto('   '));
  assert.equal(spaces.code, 'INVALID_PATH');

  const rootItself = await catchStorageError(readIdCardPhoto(ID_CARD_DIR_NAME));
  assert.equal(rootItself.code, 'INVALID_PATH');
});

test('удаление файла работает и идемпотентно', async () => {
  const relativePath = await saveIdCardPhoto(STUDENT_ID, JPEG_BYTES, 'image/jpeg');

  await deleteIdCardPhoto(relativePath);

  const readAfterDelete = await catchStorageError(readIdCardPhoto(relativePath));
  assert.equal(readAfterDelete.code, 'NOT_FOUND');

  // Повторное удаление не является ошибкой.
  await deleteIdCardPhoto(relativePath);
});

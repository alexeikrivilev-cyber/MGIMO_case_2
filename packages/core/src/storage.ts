/**
 * Приватное хранилище фото студенческих билетов.
 *
 * Файлы лежат в `storage/id-cards/<studentId>/<uuid>.<ext>` ВНЕ webroot:
 * Next.js отдаёт как статику только `public/`, поэтому каталог `storage/`
 * в корне репозитория недоступен по прямой ссылке. В базе хранится только
 * путь относительно корня хранилища — абсолютные пути сервера в БД не попадают.
 *
 * Ограничения (требование кейса): доступ только владельцу и верификатору,
 * никаких публичных ссылок, никаких секретов в путях.
 *
 * Корень хранилища переопределяется переменной окружения STORAGE_DIR
 * (см. .env.example) — например, на том или в контейнере.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Имя каталога с фото студбилетов внутри корня хранилища. */
export const ID_CARD_DIR_NAME = 'id-cards';

/** Максимальный размер фото — 5 МБ. */
export const MAX_ID_CARD_SIZE_BYTES = 5 * 1024 * 1024;

/** Допустимые MIME-типы и их расширения. */
export const ID_CARD_ALLOWED_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Безопасный сегмент пути: идентификатор студента или имя файла. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type IdCardStorageErrorCode =
  | 'INVALID_PATH'
  | 'INVALID_MIME'
  | 'FILE_TOO_LARGE'
  | 'NOT_FOUND';

export class IdCardStorageError extends Error {
  readonly code: IdCardStorageErrorCode;

  constructor(code: IdCardStorageErrorCode, message: string) {
    super(message);
    this.name = 'IdCardStorageError';
    this.code = code;
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Корень приватного хранилища: STORAGE_DIR из окружения или `storage/`
 * в корне монорепо. Переменная читается на каждый вызов, чтобы тесты
 * и разные окружения не переписывали модуль.
 */
export function storageRoot(): string {
  const configured = process.env.STORAGE_DIR;
  if (configured !== undefined && configured.trim() !== '') {
    return resolve(configured.trim());
  }
  // packages/core/src/storage.ts → корень монорепо
  return resolve(moduleDir, '../../../storage');
}

/** Корень каталога фото студбилетов. */
export function idCardRoot(): string {
  return resolve(storageRoot(), ID_CARD_DIR_NAME);
}

/**
 * Путь фото относительно корня хранилища — именно он лежит в БД
 * (StudentVerification.idCardPhotoPath).
 */
export function idCardPhotoRelativePath(studentId: string, fileName: string): string {
  return `${ID_CARD_DIR_NAME}/${studentId}/${fileName}`;
}

function assertSafeSegment(value: string, what: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new IdCardStorageError(
      'INVALID_PATH',
      `Недопустимый ${what}: "${value}". Разрешены латиница, цифры, точка, дефис и подчёркивание.`,
    );
  }
}

/**
 * Нормализует путь и гарантирует, что он остаётся внутри каталога
 * студбилетов: защита от path traversal (`../../../etc/passwd`, абсолютные
 * пути, обход через `..`). Путь в БД — относительный от корня хранилища
 * и всегда начинается с `id-cards/`.
 */
function resolveInsideIdCardRoot(pathValue: string): string {
  if (typeof pathValue !== 'string' || pathValue.trim() === '') {
    throw new IdCardStorageError('INVALID_PATH', 'Путь к файлу не задан.');
  }

  const idCards = idCardRoot();
  const candidate = isAbsolute(pathValue) ? resolve(pathValue) : resolve(storageRoot(), pathValue);

  if (candidate === idCards || candidate === resolve(storageRoot())) {
    throw new IdCardStorageError('INVALID_PATH', 'Путь должен указывать на файл внутри хранилища.');
  }
  if (!candidate.startsWith(idCards + sep)) {
    throw new IdCardStorageError(
      'INVALID_PATH',
      'Путь выходит за пределы приватного хранилища студбилетов.',
    );
  }

  return candidate;
}

function assertStudentId(studentId: string): void {
  if (typeof studentId !== 'string' || studentId.trim() === '') {
    throw new IdCardStorageError('INVALID_PATH', 'Идентификатор студента не задан.');
  }
  assertSafeSegment(studentId, 'идентификатор студента');
}

function extensionForMime(mime: string): string {
  const extension = ID_CARD_ALLOWED_MIME[mime];
  if (extension === undefined) {
    throw new IdCardStorageError(
      'INVALID_MIME',
      `Недопустимый тип файла "${mime}". Разрешены: ${Object.keys(ID_CARD_ALLOWED_MIME).join(', ')}.`,
    );
  }
  return extension;
}

/**
 * Сохраняет фото студбилета и возвращает путь относительно корня хранилища.
 * Создаёт каталог `id-cards/<studentId>/` при необходимости.
 */
export async function saveIdCardPhoto(
  studentId: string,
  buffer: Buffer,
  mime: string,
): Promise<string> {
  assertStudentId(studentId);
  if (!Buffer.isBuffer(buffer)) {
    throw new IdCardStorageError('INVALID_PATH', 'Ожидался буфер с содержимым файла.');
  }
  const extension = extensionForMime(mime);
  if (buffer.byteLength === 0) {
    throw new IdCardStorageError('FILE_TOO_LARGE', 'Файл пустой.');
  }
  if (buffer.byteLength > MAX_ID_CARD_SIZE_BYTES) {
    throw new IdCardStorageError(
      'FILE_TOO_LARGE',
      `Размер файла ${buffer.byteLength} байт превышает лимит ${MAX_ID_CARD_SIZE_BYTES} байт (5 МБ).`,
    );
  }

  const fileName = `${randomUUID()}.${extension}`;
  const relativePath = idCardPhotoRelativePath(studentId, fileName);
  const absolutePath = resolveInsideIdCardRoot(relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer, { flag: 'wx' });

  return relativePath;
}

/** Читает фото студбилета по пути из БД. */
export async function readIdCardPhoto(pathValue: string): Promise<Buffer> {
  const absolutePath = resolveInsideIdCardRoot(pathValue);
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new IdCardStorageError('NOT_FOUND', 'Фото студбилета не найдено в хранилище.');
    }
    throw error;
  }
}

/**
 * Удаляет фото студбилета. Идемпотентен: отсутствующий файл не считается
 * ошибкой (повторное удаление при отзыве заявки не должно ломать процесс).
 * Попытка выйти за пределы хранилища всегда отклоняется.
 */
export async function deleteIdCardPhoto(pathValue: string): Promise<void> {
  const absolutePath = resolveInsideIdCardRoot(pathValue);
  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

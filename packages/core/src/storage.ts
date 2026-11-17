/**
 * Приватное хранилище файлов кабинета: фото студенческих билетов, фото
 * справок о болезни и учебные планы преподавателей (RAG-ассистент).
 *
 * Файлы лежат в `storage/<сущность>/<владелец>/<uuid>.<ext>` ВНЕ webroot:
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

/** Имя каталога с фото справок о болезни внутри корня хранилища. */
export const SICK_LEAVE_DIR_NAME = 'sick-leave-certificates';

/**
 * Имя каталога с учебными планами преподавателей внутри корня хранилища
 * (BRIEF v2 §5: RAG-ассистент преподавателя). Файл плана лежит в
 * `study-plans/<teacherId>/<uuid>.<ext>` — так же вне webroot и так же
 * без публичных ссылок, как фото студбилетов.
 */
export const STUDY_PLAN_DIR_NAME = 'study-plans';

/** Максимальный размер фото — 5 МБ. */
export const MAX_ID_CARD_SIZE_BYTES = 5 * 1024 * 1024;

/** Максимальный размер учебного плана — 1 МБ текста. */
export const MAX_STUDY_PLAN_SIZE_BYTES = 1024 * 1024;

/** Допустимые MIME-типы и их расширения (фото студбилетов и справок). */
export const ID_CARD_ALLOWED_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Допустимые MIME-типы учебного плана: текстовые .md/.txt (до 1 МБ).
 * Ключ — MIME из браузера или выведенный из расширения файла, значение —
 * расширение сохраняемого файла.
 */
export const STUDY_PLAN_ALLOWED_MIME: Readonly<Record<string, string>> = {
  'text/markdown': 'md',
  'text/plain': 'txt',
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

/** Корень каталога фото справок о болезни. */
export function sickLeaveRoot(): string {
  return resolve(storageRoot(), SICK_LEAVE_DIR_NAME);
}

/** Корень каталога учебных планов преподавателей. */
export function studyPlanRoot(): string {
  return resolve(storageRoot(), STUDY_PLAN_DIR_NAME);
}

/**
 * Путь фото относительно корня хранилища — именно он лежит в БД
 * (StudentVerification.idCardPhotoPath).
 */
export function idCardPhotoRelativePath(studentId: string, fileName: string): string {
  return `${ID_CARD_DIR_NAME}/${studentId}/${fileName}`;
}

/** Путь фото справки относительно корня хранилища (SickLeave.attachmentPath). */
export function sickLeaveCertificateRelativePath(studentId: string, fileName: string): string {
  return `${SICK_LEAVE_DIR_NAME}/${studentId}/${fileName}`;
}

/** Путь учебного плана относительно корня хранилища (StudyPlan.storagePath). */
export function studyPlanRelativePath(teacherId: string, fileName: string): string {
  return `${STUDY_PLAN_DIR_NAME}/${teacherId}/${fileName}`;
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
 * Нормализует путь и гарантирует, что он остаётся внутри указанного
 * каталога хранилища: защита от path traversal (`../../../etc/passwd`,
 * абсолютные пути, обход через `..`). Путь в БД — относительный от корня
 * хранилища и всегда начинается с имени каталога сущности.
 */
function resolveInsideRoot(root: string, pathValue: string, what: string): string {
  if (typeof pathValue !== 'string' || pathValue.trim() === '') {
    throw new IdCardStorageError('INVALID_PATH', 'Путь к файлу не задан.');
  }

  const candidate = isAbsolute(pathValue) ? resolve(pathValue) : resolve(storageRoot(), pathValue);

  if (candidate === root || candidate === resolve(storageRoot())) {
    throw new IdCardStorageError('INVALID_PATH', 'Путь должен указывать на файл внутри хранилища.');
  }
  if (!candidate.startsWith(root + sep)) {
    throw new IdCardStorageError(
      'INVALID_PATH',
      `Путь выходит за пределы приватного хранилища (${what}).`,
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

function extensionForMime(mime: string, allowed: Readonly<Record<string, string>>): string {
  const extension = allowed[mime];
  if (extension === undefined) {
    throw new IdCardStorageError(
      'INVALID_MIME',
      `Недопустимый тип файла "${mime}". Разрешены: ${Object.keys(allowed).join(', ')}.`,
    );
  }
  return extension;
}

/** Правила сохранения файла сущности: допустимые типы и лимит размера. */
interface SaveFileRules {
  readonly allowedMime: Readonly<Record<string, string>>;
  readonly maxBytes: number;
  /** Подпись лимита в сообщении об ошибке: «5 МБ», «1 МБ». */
  readonly limitLabel: string;
}

const ID_CARD_RULES: SaveFileRules = {
  allowedMime: ID_CARD_ALLOWED_MIME,
  maxBytes: MAX_ID_CARD_SIZE_BYTES,
  limitLabel: '5 МБ',
};

const STUDY_PLAN_RULES: SaveFileRules = {
  allowedMime: STUDY_PLAN_ALLOWED_MIME,
  maxBytes: MAX_STUDY_PLAN_SIZE_BYTES,
  limitLabel: '1 МБ',
};

/**
 * Общее сохранение файла в каталог сущности: проверка сегмента владельца,
 * MIME и размера, имя файла — uuid с расширением по MIME. Возвращает путь
 * относительно корня хранилища.
 */
async function saveFile(
  dirName: string,
  studentId: string,
  buffer: Buffer,
  mime: string,
  rules: SaveFileRules,
): Promise<string> {
  assertStudentId(studentId);
  if (!Buffer.isBuffer(buffer)) {
    throw new IdCardStorageError('INVALID_PATH', 'Ожидался буфер с содержимым файла.');
  }
  const extension = extensionForMime(mime, rules.allowedMime);
  if (buffer.byteLength === 0) {
    throw new IdCardStorageError('FILE_TOO_LARGE', 'Файл пустой.');
  }
  if (buffer.byteLength > rules.maxBytes) {
    throw new IdCardStorageError(
      'FILE_TOO_LARGE',
      `Размер файла ${buffer.byteLength} байт превышает лимит ${rules.maxBytes} байт (${rules.limitLabel}).`,
    );
  }

  const fileName = `${randomUUID()}.${extension}`;
  const relativePath = `${dirName}/${studentId}/${fileName}`;
  const absolutePath = resolve(storageRoot(), relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer, { flag: 'wx' });

  return relativePath;
}

/** Читает файл по пути из БД внутри указанного каталога. */
async function readFileInside(root: string, pathValue: string, what: string): Promise<Buffer> {
  const absolutePath = resolveInsideRoot(root, pathValue, what);
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new IdCardStorageError('NOT_FOUND', `Файл (${what}) не найден в хранилище.`);
    }
    throw error;
  }
}

/**
 * Удаляет файл. Идемпотентен: отсутствующий файл не считается ошибкой
 * (повторное удаление при отзыве заявки не должно ломать процесс).
 * Попытка выйти за пределы хранилища всегда отклоняется.
 */
async function deleteFileInside(root: string, pathValue: string, what: string): Promise<void> {
  const absolutePath = resolveInsideRoot(root, pathValue, what);
  try {
    await unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
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
  return saveFile(ID_CARD_DIR_NAME, studentId, buffer, mime, ID_CARD_RULES);
}

/** Сохраняет фото справки о болезни (каталог `sick-leave-certificates/`). */
export async function saveSickLeaveCertificate(
  studentId: string,
  buffer: Buffer,
  mime: string,
): Promise<string> {
  return saveFile(SICK_LEAVE_DIR_NAME, studentId, buffer, mime, ID_CARD_RULES);
}

/**
 * Сохраняет учебный план преподавателя (каталог `study-plans/<teacherId>/`).
 * Только текстовые .md/.txt до 1 МБ: план читает ассистент преподавателя,
 * инициатива uploadStudyPlan в services/studyPlan.ts.
 */
export async function saveStudyPlan(
  teacherId: string,
  buffer: Buffer,
  mime: string,
): Promise<string> {
  return saveFile(STUDY_PLAN_DIR_NAME, teacherId, buffer, mime, STUDY_PLAN_RULES);
}

/** Читает фото студбилета по пути из БД. */
export async function readIdCardPhoto(pathValue: string): Promise<Buffer> {
  return readFileInside(idCardRoot(), pathValue, 'студбилетов');
}

/** Читает фото справки о болезни по пути из БД. */
export async function readSickLeaveCertificate(pathValue: string): Promise<Buffer> {
  return readFileInside(sickLeaveRoot(), pathValue, 'справок о болезни');
}

/**
 * Удаляет фото студбилета. Идемпотентен: отсутствующий файл не считается
 * ошибкой (повторное удаление при отзыве заявки не должно ломать процесс).
 * Попытка выйти за пределы хранилища всегда отклоняется.
 */
export async function deleteIdCardPhoto(pathValue: string): Promise<void> {
  return deleteFileInside(idCardRoot(), pathValue, 'студбилетов');
}

/** Удаляет фото справки о болезни (идемпотентно, как и студбилет). */
export async function deleteSickLeaveCertificate(pathValue: string): Promise<void> {
  return deleteFileInside(sickLeaveRoot(), pathValue, 'справок о болезни');
}

/**
 * Читает учебный план по пути из БД. Путь обязан оставаться внутри
 * `storage/study-plans/` — выход за пределы отклоняется (path traversal).
 */
export async function readStudyPlan(pathValue: string): Promise<Buffer> {
  return readFileInside(studyPlanRoot(), pathValue, 'учебных планов');
}

/** Удаляет учебный план (идемпотентно: отсутствующий файл не ошибка). */
export async function deleteStudyPlan(pathValue: string): Promise<void> {
  return deleteFileInside(studyPlanRoot(), pathValue, 'учебных планов');
}

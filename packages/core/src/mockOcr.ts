/**
 * ЧЕСТНЫЙ мок распознавания студенческого билета (без OCR и без ML).
 *
 * Это ЗАГЛУШКА-ЭМУЛЯЦИЯ распознавания: она не смотрит на пиксели фото
 * и не делает никаких выводов о содержании изображения. Единственное,
 * что она делает, — находит номер карточки (который пользователь
 * ввёл/подтвердил на клиенте) в синтетическом реестре IdentityRegistry
 * и возвращает связанные с ним поля. Ничего не «додумывается»:
 * если номера нет в реестре — возвращает found=false и пустые поля.
 *
 * ТОЧКА ИНТЕГРАЦИИ РЕАЛЬНОГО OCR (когда появится сервис распознавания):
 * заменить вызов recognizeIdCard в services/verification.ts на вызов
 * реального сервиса, который по photoBuffer вернёт ту же структуру
 * IdCardRecognition. Контракт (cardNumber + ФИО + группа + confidence)
 * специально спроектирован так, чтобы замена не затронула остальной код.
 *
 * Реальные фото и персональные данные через эту функцию не проходят:
 * на вход идут только строки реестра, confidence — детерминированная
 * константа, а не результат «анализа».
 */

/** Запись реестра, необходимая для распознавания. */
export interface IdentityRegistryEntryLike {
  readonly cardNumber: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly groupName: string;
}

/** Результат «распознавания» (мок). */
export interface IdCardRecognition {
  /** Найден ли номер в реестре. */
  readonly found: boolean;
  readonly cardNumber: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly groupName: string;
  /** Уверенность «распознавания» 0..1 (константа мока). */
  readonly confidence: number;
}

/**
 * Детерминированная уверенность мока: фиксирована, без случайности,
 * чтобы поведение верификации было воспроизводимым в тестах и на приёмке.
 */
export const MOCK_OCR_CONFIDENCE = 0.98;

/** Результат для номера, отсутствующего в реестре. */
export function notFoundRecognition(cardNumber: string): IdCardRecognition {
  return {
    found: false,
    cardNumber,
    lastName: '',
    firstName: '',
    middleName: null,
    groupName: '',
    confidence: 0,
  };
}

/**
 * Ищет карточку в реестре по номеру (точное совпадение, регистр и
 * пробелы по краям игнорируются). Детерминирована: один и тот же реестр
 * всегда даёт один и тот же результат.
 */
export function recognizeIdCard(
  cardNumber: string,
  registry: readonly IdentityRegistryEntryLike[],
): IdCardRecognition {
  const normalized = typeof cardNumber === 'string' ? cardNumber.trim().toUpperCase() : '';
  if (normalized === '') {
    return notFoundRecognition('');
  }

  const entry = registry.find((candidate) => candidate.cardNumber.trim().toUpperCase() === normalized);
  if (entry === undefined) {
    return notFoundRecognition(normalized);
  }

  return {
    found: true,
    cardNumber: normalized,
    lastName: entry.lastName,
    firstName: entry.firstName,
    middleName: entry.middleName,
    groupName: entry.groupName,
    confidence: MOCK_OCR_CONFIDENCE,
  };
}

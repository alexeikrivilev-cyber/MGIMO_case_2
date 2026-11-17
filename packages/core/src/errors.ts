/**
 * Базовые ошибки домена packages/core.
 *
 * Единый корень CoreError с машинным кодом: маршруты API (P1.4) по коду
 * выбирают HTTP-статус, а сообщения намеренно обобщены — не раскрывают,
 * существует ли запрошенный объект (защита от перебора идентификаторов).
 */

/** Базовая ошибка ядра: всегда несёт машинный код. */
export class CoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}

export type OwnershipErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_A_STUDENT'
  | 'NOT_OWNER'
  | 'FORBIDDEN_ROLE'
  | 'STAFF_ONLY';

/**
 * Ошибка авторизации владения данными.
 *
 * Коды:
 * - UNAUTHENTICATED — сессии нет или она невалидна;
 * - NOT_A_STUDENT   — операция доступна только студенту (user.studentId);
 * - NOT_OWNER       — запрошенный идентификатор не принадлежит сессии;
 * - FORBIDDEN_ROLE  — роль не подходит для операции;
 * - STAFF_ONLY      — операция только для сотрудников деканата/админа.
 */
export class OwnershipError extends CoreError {
  constructor(code: OwnershipErrorCode, message: string) {
    super(code, message);
    this.name = 'OwnershipError';
  }
}

export type ValidationErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERIFICATION_REQUIRED';

/**
 * Ошибка входных данных и бизнес-правил (zod, состояние заявки,
 * пересечение периодов «болею», закрытый гейт верификации).
 */
export class ValidationError extends CoreError {
  readonly details?: readonly string[];

  constructor(code: ValidationErrorCode, message: string, details?: readonly string[]) {
    super(code, message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

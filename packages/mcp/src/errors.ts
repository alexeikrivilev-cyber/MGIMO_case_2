/**
 * Ошибки MCP-сервера и таблица соответствия ошибок packages/core.
 *
 * ЗАЧЕМ: агент деканата — программа, но решение по инструменту принимает
 * по тексту ошибки человек (или LLM), поэтому код ошибки должен быть
 * машинным (JSON-RPC), а сообщение — человеческим и однозначным.
 *
 * Таблица намеренно повторяет логику apps/web/lib/session.ts
 * (coreErrorResponse), но в координатах JSON-RPC вместо HTTP:
 *   UNAUTHENTICATED         → SESSION_INVALID  (сессия невалидна);
 *   NOT_OWNER / STAFF_ONLY / FORBIDDEN_ROLE / NOT_A_* → FORBIDDEN;
 *   VERIFICATION_REQUIRED   → FORBIDDEN;
 *   INVALID_INPUT           → INVALID_PARAMS (-32602, стандартный);
 *   CONFLICT                → CONFLICT;
 *   NOT_FOUND               → NOT_FOUND;
 *   прочее                  → INTERNAL_ERROR.
 *
 * Сообщения владения/прав берём У ЯДРА: они уже обобщены («не найдено
 * или недоступно») и не различают «не существует» и «не ваше» — иначе
 * по ошибке можно было бы перебором проверять чужие идентификаторы.
 * Сообщения бизнес-правил (CONFLICT, NOT_FOUND, INVALID_INPUT) тоже от
 * ядра: это подсказка про данные самой сессии, её нельзя заменить на
 * безликкую «ошибку».
 */
import { CoreError, OwnershipError, ValidationError } from '@udgu/core';
import { JSON_RPC_ERROR } from './protocol';

/** Ошибка уровня MCP-сервера (готова к отправке клиенту). */
export class McpError extends Error {
  readonly code: number;
  /** Машинный код ядра (NOT_OWNER, INVALID_INPUT…) — для клиента-программы. */
  readonly coreCode: string | undefined;
  /** Уточнения от zod/ядра (какие поля неверны). */
  readonly details: readonly string[] | undefined;

  constructor(
    code: number,
    message: string,
    options: { coreCode?: string; details?: readonly string[] } = {},
  ) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.coreCode = options.coreCode;
    this.details = options.details;
  }
}

/** Токен сессии не передан: ни в окружении, ни в initialize. */
export function sessionRequiredError(): McpError {
  return new McpError(
    JSON_RPC_ERROR.SESSION_REQUIRED,
    'Не передан токен сессии сотрудника. Задайте MCP_SESSION_TOKEN или передайте sessionToken в initialize.',
    { coreCode: 'UNAUTHENTICATED' },
  );
}

/** Токен передан, но сессия не найдена или истекла. */
export function sessionInvalidError(): McpError {
  return new McpError(
    JSON_RPC_ERROR.SESSION_INVALID,
    'Сессия недействительна или истекла. Войдите в кабинет заново и получите новый токен.',
    { coreCode: 'UNAUTHENTICATED' },
  );
}

/**
 * Превращает любое исключение сервиса ядра в ошибку MCP.
 *
 * Неизвестное исключение → INTERNAL_ERROR с обезличенным текстом:
 * детали уходят в лог (stderr), клиенту — только код. Ошибки ядра —
 * с человеческим текстом самого ядра.
 */
export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error;
  }

  if (error instanceof OwnershipError) {
    switch (error.code) {
      case 'UNAUTHENTICATED':
        return sessionInvalidError();
      case 'NOT_OWNER':
      case 'STAFF_ONLY':
      case 'FORBIDDEN_ROLE':
      case 'NOT_A_STUDENT':
      case 'NOT_A_TEACHER':
        return new McpError(JSON_RPC_ERROR.FORBIDDEN, error.message, { coreCode: error.code });
      default:
        return new McpError(JSON_RPC_ERROR.INTERNAL_ERROR, 'Операция недоступна.', { coreCode: error.code });
    }
  }

  if (error instanceof ValidationError) {
    switch (error.code) {
      case 'INVALID_INPUT':
        return new McpError(JSON_RPC_ERROR.INVALID_PARAMS, error.message, {
          coreCode: error.code,
          details: error.details,
        });
      case 'CONFLICT':
        return new McpError(JSON_RPC_ERROR.CONFLICT, error.message, { coreCode: error.code });
      case 'NOT_FOUND':
        return new McpError(JSON_RPC_ERROR.NOT_FOUND, error.message, { coreCode: error.code });
      case 'VERIFICATION_REQUIRED':
        return new McpError(JSON_RPC_ERROR.FORBIDDEN, error.message, { coreCode: error.code });
      default:
        return new McpError(JSON_RPC_ERROR.INTERNAL_ERROR, 'Операция отклонена.', { coreCode: error.code });
    }
  }

  if (error instanceof CoreError) {
    return new McpError(JSON_RPC_ERROR.INTERNAL_ERROR, 'Операция недоступна.', { coreCode: error.code });
  }

  return new McpError(JSON_RPC_ERROR.INTERNAL_ERROR, 'Внутренняя ошибка сервера. Попробуйте позже.');
}

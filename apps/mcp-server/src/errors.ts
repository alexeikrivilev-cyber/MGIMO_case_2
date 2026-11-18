/**
 * Ошибки MCP-сервера деканата: текст ДЛЯ ЧЕЛОВЕКА.
 *
 * ЗАЧЕМ: агент деканата — программа, но решение по инструменту принимает
 * по тексту ошибки человек (или LLM), поэтому сообщение должно быть
 * однозначным и человеческим, а не «ECONNREFUSED».
 *
 * ПОЧЕМУ isError, А НЕ JSON-RPC error: спецификация MCP требует, чтобы
 * ошибки САМОГО инструмента (нет прав, нарушено бизнес-правило,
 * сущность не найдена) возвращались внутри result с isError=true —
 * иначе LLM не увидит, что вызов нужно повторить иначе. JSON-RPC error
 * остаётся для отказов транспорта/авторизации (HTTP-слой, см. http.ts).
 *
 * СООБЩЕНИЯ ВЛАДЕНИЯ И ПРАВ БЕРЁМ У ЯДРА: они уже обобщены («не найдено
 * или недоступно») и не различают «не существует» и «не ваше» — иначе
 * по ошибке можно было бы перебором проверять чужие идентификаторы.
 * Сообщения бизнес-правил (CONFLICT, NOT_FOUND, INVALID_INPUT) тоже от
 * ядра: это подсказка про данные самой сессии, её нельзя заменить на
 * безликкую «ошибка».
 */
import { CoreError, ValidationError } from '@udgu/core';

/**
 * Ошибка авторизации MCP-сервера: токен не передан или сессия мертва.
 *
 * Отдельный класс (не CoreError ядра): причина транспортная, а не
 * доменная, и текст должен называть конкретный способ её устранить —
 * env для stdio, заголовок для HTTP.
 */
export class SessionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionAuthError';
  }
}

/** Токен сессии не передан: ни в окружении, ни в заголовке Authorization. */
export function sessionRequiredError(): SessionAuthError {
  return new SessionAuthError(
    'Не передан токен сессии сотрудника. ' +
      'Задайте MCP_SESSION_TOKEN (stdio) или заголовок Authorization: Bearer <токен> (HTTP).',
  );
}

/** Токен передан, но сессия не найдена или истекла. */
export function sessionInvalidError(): SessionAuthError {
  return new SessionAuthError(
    'Сессия недействительна или истекла. Войдите в кабинет заново и получите новый токен.',
  );
}

/** Текст ошибки инструмента для клиента (result.isError). */
export function toolErrorMessage(error: unknown): string {
  if (error instanceof SessionAuthError) {
    return error.message;
  }
  // Ошибки ядра (OwnershipError/ValidationError/CoreError) уже несут
  // человеческий текст — отдаём его как есть.
  if (error instanceof CoreError) {
    // Уточнения по полям (zod-issues ядра) дописываем: агенту нужна не
    // только причина, но и ЧТО исправить — иначе он повторит тот же вызов.
    const details = error instanceof ValidationError ? error.details : undefined;
    if (details !== undefined && details.length > 0) {
      return `${error.message} ${details.join('; ')}`;
    }
    return error.message;
  }
  // Неожиданный сбой: детали уходят в лог (stderr), клиенту — только
  // обезличенный текст.
  return 'Внутренняя ошибка сервера. Попробуйте позже.';
}

/** Нужно ли логировать ошибку подробно (неожиданный сбой, а не отказ ядра). */
export function isUnexpectedError(error: unknown): boolean {
  return !(error instanceof CoreError) && !(error instanceof SessionAuthError);
}

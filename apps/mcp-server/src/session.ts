/**
 * Сессия сотрудника деканата для MCP-сервера.
 *
 * АВТОРИЗАЦИЯ (архитектурное решение Hermes, BRIEF v2 §7):
 *   НОВОЙ модели пользователей и токенов в схеме НЕ появилось. Сервер
 *   принимает СУЩЕСТВУЮЩИЙ токен сессии кабинета — тот самый, который
 *   получает staff1 входом на сайте (httpOnly-cookie udgu_session), —
 *   и валидирует его боевым validateSession из packages/core. Дальше
 *   все инструменты вызывают сервисы кабинета с этой сессией, поэтому
 *   права проверяет ядро (requireStaffScope), а не сервер MCP: он не
 *   знает правил.
 *
 * ОТКУДА ТОКЕН:
 *   - stdio: env MCP_SESSION_TOKEN (resolveToken читает окружение);
 *   - HTTP:  заголовок Authorization: Bearer <токен>.
 *   Источник один — токен сессии кабинета; своих токенов у сервера нет.
 *
 * ТОКЕН НИКОГДА НЕ ЛОГИРУЕТСЯ. Ни в stdout (это канал протокола), ни в
 *   stderr, ни в тексте ошибки: токен сессии равносилен паролю. Во все
 *   диагностики попадает только факт наличия (describeTokenPresence).
 *
 * ВАЛИДАЦИЯ НА КАЖДЫЙ ВЫЗОВ: сессия не кешируется. Иначе отзыв сессии
 *   (выход, смена пароля) не отключал бы агента до перезапуска
 *   процесса. validateSession — один запрос в БД, это дешевле, чем
 *   «живущий» токен после отзыва.
 */
import { validateSession, type AuthSession } from '@udgu/core';
import { sessionInvalidError, sessionRequiredError } from './errors.js';

/** Имя переменной окружения с токеном сессии сотрудника (stdio). */
export const SESSION_TOKEN_ENV = 'MCP_SESSION_TOKEN';

/** Нормализует токен: нестрока и пустая строка → null. */
function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Токен из окружения процесса (stdio-транспорт).
 *
 * Читается на каждый вызов: переменную могут выставить уже после
 * старта процесса (например, в тестах), а «запомненный» на старте
 * токен устарел бы при смене окружения.
 */
export function tokenFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  return normalizeToken(env[SESSION_TOKEN_ENV]);
}

/**
 * Валидная сессия сотрудника по токену.
 *
 * Бросает SessionAuthError:
 * - токена нет вовсе → sessionRequiredError;
 * - токен есть, но сессия не найдена/истекла → sessionInvalidError.
 *
 * Права (STAFF/ADMIN, факультет) здесь НЕ проверяются: это дело
 * сервисов ядра, и каждый инструмент получает свой точный отказ.
 */
export async function requireSession(token: string | null): Promise<AuthSession> {
  if (token === null) {
    throw sessionRequiredError();
  }
  const session = await validateSession(token);
  if (session === null) {
    throw sessionInvalidError();
  }
  return session;
}

/**
 * Описание наличия токена для логов — БЕЗ значения.
 *
 * Токен сессии равносилен паролю: он не должен попасть ни в stdout
 * (канал протокола), ни в stderr (логи), ни в сообщение об ошибке.
 * Поэтому в диагностиках печатается только факт его наличия.
 */
export function describeTokenPresence(token: string | null): string {
  if (token === null || token.trim() === '') {
    return 'токен не передан';
  }
  return 'токен передан';
}

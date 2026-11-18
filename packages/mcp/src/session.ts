/**
 * Сессия сотрудника деканата для MCP-сервера.
 *
 * АВТОРИЗАЦИЯ (архитектурное решение Hermes, BRIEF v2 §7):
 *   НОВОЙ модели пользователей и токенов в схеме НЕ появилось. Сервер
 *   принимает СУЩЕСТВУЮЩИЙ токен сессии кабинета — тот самый, который
 *   получает staff1 входом на сайте (httpOnly-cookie), — и валидирует
 *   его боевым validateSession из packages/core. Дальше все инструменты
 *   вызывают сервисы кабинета с этой сессией, поэтому права проверяет
 *   ядро (requireStaffScope), а не сервер MCP: он не знает правил.
 *
 * ОТКУДА ТОКЕН:
 *   - env MCP_SESSION_TOKEN (основной способ для живого агента);
 *   - params.sessionToken в initialize (явный параметр клиента).
 *   Явный параметр имеет приоритет: агент, передавший токен, должен
 *   получить отказ по НЕМУ, а не тихо работать от окружения.
 *
 * ТОКЕН НИКОГДА НЕ ЛОГИРУЕТСЯ. Ни в stdout (это канал протокола), ни в
 *   stderr, ни в тексте ошибки: токен сессии равносилен паролю. Во все
 *   диагностики попадает только факт наличия (describeTokenPresence).
 *
 * ВАЛИДАЦИЯ НА КАЖДЫЙ ВЫЗОВ: не кешируем AuthSession. Иначе отзыв
 *   сессии (выход, смена пароля) не отключал бы агента до перезапуска
 *   процесса. validateSession — один запрос в БД, это дешевле, чем
 *   «живущий» токен после отзыва.
 */
import { validateSession, type AuthSession } from '@udgu/core';
import { sessionInvalidError, sessionRequiredError } from './errors';

/** Имя переменной окружения с токеном сессии сотрудника. */
export const SESSION_TOKEN_ENV = 'MCP_SESSION_TOKEN';

/** Имя поля в params initialize, которым клиент может передать токен. */
export const SESSION_TOKEN_PARAM = 'sessionToken';

/** Откуда взят токен (для логов — без значения). */
export type TokenSource = 'env' | 'initialize' | 'none';

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export class SessionContext {
  #token: string | null;
  #source: TokenSource;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.#token = normalizeToken(env[SESSION_TOKEN_ENV]);
    this.#source = this.#token === null ? 'none' : 'env';
  }

  /**
   * Принимает токен из params initialize. Явный токен клиента заменяет
   * токен окружения (в том числе на заведомо неверный — тихого отката
   * к env нет). Нестрока/пустая строка игнорируются: окружение живо.
   */
  adoptFromInitialize(params: unknown): void {
    if (typeof params !== 'object' || params === null) {
      return;
    }
    const token = normalizeToken((params as Record<string, unknown>)[SESSION_TOKEN_PARAM]);
    if (token === null) {
      return;
    }
    this.#token = token;
    this.#source = 'initialize';
  }

  /** Есть ли токен (без значения). */
  get hasToken(): boolean {
    return this.#token !== null;
  }

  /** Откуда токен — только для диагностики. */
  get source(): TokenSource {
    return this.#source;
  }

  /**
   * Валидная сессия сотрудника. Бросает McpError:
   * - SESSION_REQUIRED — токена нет вовсе;
   * - SESSION_INVALID — токен есть, но сессия не найдена/истекла.
   *
   * Права (STAFF/ADMIN, факультет) здесь НЕ проверяются: это дело
   * сервисов ядра, и каждый инструмент получает свой точный отказ.
   */
  async requireSession(): Promise<AuthSession> {
    if (this.#token === null) {
      throw sessionRequiredError();
    }
    const session = await validateSession(this.#token);
    if (session === null) {
      throw sessionInvalidError();
    }
    return session;
  }
}

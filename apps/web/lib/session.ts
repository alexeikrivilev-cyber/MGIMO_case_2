/**
 * Сессия и авторизация на границе apps/web.
 *
 * Обёртки над packages/core (единственный источник правил сессий):
 * - cookie читается из запроса и валидируется боевым validateSession;
 * - маршруты получают сессию через requireSession/requireStaff;
 * - ошибки ядра (OwnershipError/ValidationError/CoreError) отображаются
 *   в HTTP-статусы по машинному коду.
 *
 * КЛЮЧЕВОЕ ПРАВИЛО БЕЗОПАСНОСТЫ (ARCHITECTURE §3, ACCEPTANCE): код
 * владения данными (NOT_OWNER/STAFF_ONLY/FORBIDDEN_ROLE) отвечает 404,
 * а НЕ 403 — иначе ответ «есть, но не ваш» подтверждал бы существование
 * чужих идентификаторов и превращал API в оракул для перебора.
 * Сообщения обобщены и не различают «не существует» и «не твоё».
 *
 * Маршруты НЕ доверяют заголовкам запроса как источнику личности:
 * сессия всегда резолвится из httpOnly-cookie заново (middleware
 * валидирует её для гейтинга, маршрут — для решения).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  parseCookieValue,
  validateSession,
  revokeSession,
  sessionCookieName,
  csrfCookieName,
  sessionCookieAttributes,
  generateCsrfToken,
  requireStaffAccess,
  CoreError,
  OwnershipError,
  ValidationError,
  VerificationRequiredError,
  type AuthSession,
  type SessionUser,
} from '@udgu/core';
import { jsonError, type ApiErrorCode } from './http';

// ---------------------------------------------------------------------------
// Чтение сессии из запроса
// ---------------------------------------------------------------------------

/**
 * Сессия по заголовку Cookie (чистая функция — используется и маршрутами,
 * и серверными страницами, у которых нет NextRequest).
 * Возвращает null для отсутствующей/невалидной/просроченной сессии.
 */
export async function getSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): Promise<AuthSession | null> {
  const token = parseCookieValue(cookieHeader ?? null, sessionCookieName());
  if (token === null) {
    return null;
  }
  return validateSession(token);
}

/** Сессия из NextRequest (Route Handlers). null — пользователь не вошёл. */
export async function getSessionFromRequest(request: NextRequest): Promise<AuthSession | null> {
  return getSessionFromCookieHeader(request.headers.get('cookie'));
}

/**
 * Сессия для маршрута данных: бросает OwnershipError UNAUTHENTICATED
 * (→ 401), если пользователь не вошёл. Каждый маршрут данных вызывает
 * эту функцию — ни один не принимает studentId из query/body.
 */
export async function requireSession(request: NextRequest): Promise<AuthSession> {
  const session = await getSessionFromRequest(request);
  if (session === null) {
    throw new OwnershipError('UNAUTHENTICATED', 'Требуется вход в систему.');
  }
  return session;
}

/**
 * Доступ сотрудника деканата/админа (кабинет STAFF, P2). Реализован
 * на границе API сейчас: гейт роли живёт в одном месте, и страницы
 * /staff, /admin опираются на ту же проверку (middleware — по роли
 * из той же сессии).
 */
export async function requireStaff(request: NextRequest): Promise<SessionUser> {
  const session = await requireSession(request);
  return requireStaffAccess(session);
}

// ---------------------------------------------------------------------------
// Cookie в ответах
// ---------------------------------------------------------------------------

/**
 * Ставит cookie сессии: httpOnly, SameSite=Lax, Secure в продакшне,
 * Max-Age из SESSION_TTL_DAYS. Атрибуты берём из packages/core — один
 * источник истины для входа, выхода и тестов.
 */
export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  const attributes = sessionCookieAttributes();
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: attributes.httpOnly,
    secure: attributes.secure,
    sameSite: attributes.sameSite,
    path: attributes.path,
    maxAge: attributes.maxAge,
  });
  return response;
}

/**
 * Ставит CSRF-cookie с конкретным токеном (паттерн «двойная отправка»:
 * cookie читает JS и дублирует значение в заголовке X-CSRF-Token; cookie
 * намеренно без HttpOnly — она не секрет авторизации).
 */
export function setCsrfCookie(response: NextResponse, token: string): NextResponse {
  const attributes = sessionCookieAttributes();
  response.cookies.set(csrfCookieName(), token, {
    httpOnly: false,
    secure: attributes.secure,
    sameSite: attributes.sameSite,
    path: attributes.path,
    maxAge: attributes.maxAge,
  });
  return response;
}

/** Генерирует CSRF-токен, ставит cookie и возвращает токен для заголовка. */
export function issueCsrfCookie(response: NextResponse): string {
  const token = generateCsrfToken();
  setCsrfCookie(response, token);
  return token;
}

/** Удаляет cookie сессии и CSRF (Max-Age=0, пустое значение). */
export function clearSessionCookies(response: NextResponse): NextResponse {
  const attributes = sessionCookieAttributes();
  response.cookies.set(sessionCookieName(), '', {
    httpOnly: true,
    secure: attributes.secure,
    sameSite: attributes.sameSite,
    path: attributes.path,
    maxAge: 0,
  });
  response.cookies.set(csrfCookieName(), '', {
    httpOnly: false,
    secure: attributes.secure,
    sameSite: attributes.sameSite,
    path: attributes.path,
    maxAge: 0,
  });
  return response;
}

/** Отзыв сессии по токену из cookie запроса (для logout). */
export async function revokeSessionFromRequest(request: NextRequest): Promise<boolean> {
  const token = parseCookieValue(request.headers.get('cookie'), sessionCookieName());
  if (token === null) {
    return false;
  }
  await revokeSession(token);
  return true;
}

// ---------------------------------------------------------------------------
// Отображение ошибок ядра в HTTP
// ---------------------------------------------------------------------------

interface MappedError {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: readonly string[];
}

/**
 * Таблица соответствия кодов packages/core и HTTP-статусов.
 *
 * UNAUTHENTICATED → 401; NOT_OWNER/STAFF_ONLY/FORBIDDEN_ROLE → 404
 * (не 403: не раскрываем существование чужих объектов); NOT_A_STUDENT
 * → 403; VERIFICATION_REQUIRED → 403 (гейт верификации — честный
 * ответ про закрытый раздел, а не про чужую запись); INVALID_INPUT
 * → 400; CONFLICT → 409; NOT_FOUND → 404; прочее → 500.
 *
 * Обобщаем ТОЛЬКО сообщения авторизации/владения: для ошибок входных
 * данных и бизнес-правил (INVALID_INPUT, CONFLICT, NOT_FOUND) текст
 * от ядра — это подсказка пользователю про ЕГО данные («группа не
 * найдена», «отмена возможна только для новой заявки»), её нужно
 * сохранить. Сообщения владения («не твоё») всегда общие — иначе
 * ответ отличал бы «не существует» от «не ваше».
 */
function mapCoreError(error: CoreError): MappedError {
  const details = error instanceof ValidationError ? error.details : undefined;

  switch (error.code) {
    case 'UNAUTHENTICATED':
      return { status: 401, code: 'UNAUTHENTICATED', message: 'Требуется вход в систему.' };
    case 'NOT_OWNER':
    case 'STAFF_ONLY':
    case 'FORBIDDEN_ROLE':
      // Обобщённый ответ: «не существует» и «не ваше» неразличимы.
      return { status: 404, code: 'NOT_FOUND', message: 'Запрошенные данные не найдены.' };
    case 'NOT_A_STUDENT':
      return { status: 403, code: 'FORBIDDEN', message: 'Раздел доступен только студенту.' };
    case 'VERIFICATION_REQUIRED':
      return {
        status: 403,
        code: 'VERIFICATION_REQUIRED',
        message: 'Раздел доступен после верификации студенческого билета.',
      };
    case 'INVALID_INPUT':
      return { status: 400, code: 'INVALID_INPUT', message: error.message, details };
    case 'CONFLICT':
      return { status: 409, code: 'CONFLICT', message: error.message };
    case 'NOT_FOUND':
      // Сообщение ядра описывает данные самой сессии — существование
      // чужих объектов оно не раскрывает.
      return { status: 404, code: 'NOT_FOUND', message: error.message };
    default:
      return { status: 500, code: 'INTERNAL', message: 'Внутренняя ошибка сервера. Попробуйте позже.' };
  }
}

/**
 * Превращает любое исключение маршрута в JSON-ответ.
 *
 * Ошибки ядра — по таблице выше; ошибки хранилища фото — 400 (клиент
 * прислал не тот файл); всё остальное — 500 БЕЗ деталей в ответе
 * (подробности уходят в серверный лог, чтобы не светить внутренности).
 */
export function coreErrorResponse(error: unknown): NextResponse {
  if (error instanceof VerificationRequiredError) {
    return jsonError(403, 'VERIFICATION_REQUIRED', 'Раздел доступен после верификации студенческого билета.');
  }
  if (error instanceof OwnershipError || error instanceof ValidationError) {
    const mapped = mapCoreError(error);
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
  if (error instanceof CoreError) {
    const mapped = mapCoreError(error);
    return jsonError(mapped.status, mapped.code, mapped.message);
  }

  // Ошибки приватного хранилища (неверный MIME, слишком большой файл,
  // небезопасный путь) — это проблема входных данных, а не сервера.
  const storageError = error as { name?: string; code?: string; message?: string } | null;
  if (storageError !== null && typeof storageError === 'object' && storageError.name === 'IdCardStorageError') {
    return jsonError(400, 'INVALID_INPUT', 'Файл не принят: проверьте формат (JPEG, PNG или WebP) и размер до 5 МБ.');
  }

  console.error('[api] необработанная ошибка маршрута:', error);
  return jsonError(500, 'INTERNAL', 'Внутренняя ошибка сервера. Попробуйте позже.');
}

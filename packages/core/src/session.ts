/**
 * Сессии: токен в httpOnly-cookie, в базе — только sha256-хеш токена.
 *
 * Модель угроз и решения:
 * - Токен сессии — 32 байта криптослучайности (256 бит), base64url.
 *   В БД хранится ТОЛЬКО sha256(token): утечка дампа БД не позволяет
 *   предъявить токен (украсть сессию), а коллизия sha256 невозможна
 *   на практике.
 * - Срок жизни сессии — 7 дней, настраивается SESSION_TTL_DAYS (env).
 * - Просроченная сессия удаляется при первом предъявлении.
 * - Cookie: HttpOnly (недоступна JS), SameSite=Lax (защита от CSRF на
 *   навигационных переходах), Path=/, Secure — в продакшне (NODE_ENV).
 * - CSRF: двойная отправка cookie+заголовок, сравнение timingSafeEqual.
 *
 * Функции cookie намеренно чистые (строки на входе/выходе) — их можно
 * тестировать без Next.js; маршруты P1.4 оборачивают результат в
 * NextResponse.cookies.set().
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from './db';
import type { Role } from '@udgu/db';

/** Длина токена сессии в байтах (256 бит). */
export const SESSION_TOKEN_BYTES = 32;

/** Длина CSRF-токена в байтах. */
export const CSRF_TOKEN_BYTES = 32;

/** Срок жизни сессии по умолчанию, дни. */
export const DEFAULT_SESSION_TTL_DAYS = 7;

/** Имя cookie сессии по умолчанию. */
export const DEFAULT_SESSION_COOKIE_NAME = 'udgu_session';

/** Имя cookie CSRF-токена по умолчанию. */
export const DEFAULT_CSRF_COOKIE_NAME = 'udgu_csrf';

/** Заголовок, в котором ожидается CSRF-токен (двойная отправка). */
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Минимально допустимый TTL сессии, дни (защита от опечатки в env). */
const MIN_SESSION_TTL_DAYS = 1;

/**
 * Срок жизни сессии в днях: SESSION_TTL_DAYS из окружения, иначе 7.
 * Некорректное значение (не число, меньше 1) не роняет процесс —
 * используется безопасное значение по умолчанию.
 */
export function sessionTtlDays(): number {
  const raw = process.env.SESSION_TTL_DAYS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_SESSION_TTL_DAYS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_SESSION_TTL_DAYS) {
    return DEFAULT_SESSION_TTL_DAYS;
  }
  return parsed;
}

/** Срок жизни cookie сессии в секундах (для Max-Age). */
export function sessionMaxAgeSeconds(): number {
  return sessionTtlDays() * SECONDS_PER_DAY;
}

/** Имя cookie сессии: SESSION_COOKIE_NAME из окружения, иначе дефолт. */
export function sessionCookieName(): string {
  const raw = process.env.SESSION_COOKIE_NAME;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_SESSION_COOKIE_NAME;
  }
  return raw.trim();
}

/** Имя cookie CSRF-токена: CSRF_COOKIE_NAME из окружения, иначе дефолт. */
export function csrfCookieName(): string {
  const raw = process.env.CSRF_COOKIE_NAME;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_CSRF_COOKIE_NAME;
  }
  return raw.trim();
}

/**
 * Нужен ли флаг `Secure` у cookie сессии.
 *
 * `Secure` означает «отправлять cookie только по HTTPS». Это правильно для
 * продакшена за HTTPS-терминацией, но ЛОМАЕТ вход, если приложение отдаётся
 * по plain HTTP (например, проверка доступности по IP:порт до подключения
 * домена): браузер и curl просто не отправят cookie назад, и каждый запрос
 * выглядит анонимным. Именно на это напоролась первая выкладка на Helsinki.
 *
 * Поэтому: в продакшене флаг включён по умолчанию (безопасное значение), но
 * может быть явно выключен переменной SESSION_COOKIE_SECURE=false — когда
 * сервис временно работает по HTTP. Явный opt-out вместо тихой деградации.
 */
export function isSecureCookie(): boolean {
  if (process.env.SESSION_COOKIE_SECURE === 'false') {
    return false;
  }
  if (process.env.SESSION_COOKIE_SECURE === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'production';
}

/** Атрибуты cookie сессии (чистые данные — для тестов и документации). */
export interface CookieAttributes {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: string;
  readonly maxAge: number;
}

export function sessionCookieAttributes(): CookieAttributes {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds(),
  };
}

function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [`${name}=${value}`, `Path=${attributes.path}`, `Max-Age=${attributes.maxAge}`];
  if (attributes.httpOnly) {
    parts.push('HttpOnly');
  }
  if (attributes.secure) {
    parts.push('Secure');
  }
  parts.push(`SameSite=${attributes.sameSite === 'lax' ? 'Lax' : 'Strict'}`);
  return parts.join('; ');
}

/** Собирает значение Set-Cookie для сессии. */
export function buildSessionCookie(token: string): string {
  if (typeof token !== 'string' || token === '') {
    throw new TypeError('Токен сессии не может быть пустым.');
  }
  return serializeCookie(sessionCookieName(), token, sessionCookieAttributes());
}

/** Собирает Set-Cookie, удаляющий cookie сессии (Max-Age=0). */
export function buildExpiredSessionCookie(): string {
  return serializeCookie(sessionCookieName(), '', {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Собирает Set-Cookie для CSRF-токена. Намеренно БЕЗ HttpOnly:
 * паттерн «двойная отправка» требует, чтобы клиентский JS прочитал
 * cookie и продублировал значение в заголовке X-CSRF-Token. Токен
 * не является секретом авторизации — он доказывает «один браузер».
 */
export function buildCsrfCookie(token: string): string {
  if (typeof token !== 'string' || token === '') {
    throw new TypeError('CSRF-токен не может быть пустым.');
  }
  return serializeCookie(csrfCookieName(), token, {
    httpOnly: false,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds(),
  });
}

/**
 * Достаёт значение cookie по имени из заголовка Cookie.
 * Чистая функция: не зависит от платформы (Next/Node) — тестируется напрямую.
 */
export function parseCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader === '' || name === '') {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key === name) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

/** Генерирует CSRF-токен: 32 байта криптослучайности, base64url. */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
}

/** sha256-хеш токена в hex — то, что хранится в Session.tokenHash. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Сравнение токенов за постоянное время.
 *
 * Возвращает false (не бросает) при любой некондиции: пустые значения,
 * разные длины, не-hex/base64 строки. timingSafeEqual бросает на разных
 * длинах, поэтому длина проверяется явно до сравнения.
 */
export function verifyCsrfToken(token: unknown, expected: unknown): boolean {
  if (typeof token !== 'string' || typeof expected !== 'string') {
    return false;
  }
  if (token === '' || expected === '') {
    return false;
  }
  const tokenBytes = Buffer.from(token, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (tokenBytes.byteLength !== expectedBytes.byteLength) {
    return false;
  }
  return timingSafeEqual(tokenBytes, expectedBytes);
}

// ---------------------------------------------------------------------------
// Пользователь сессии
// ---------------------------------------------------------------------------

/** Пользователь в контексте сессии: роль + ссылки на профили. */
export interface SessionUser {
  readonly id: string;
  readonly login: string;
  readonly role: Role;
  /** Заполнен для роли STUDENT; null у сотрудников и админа. */
  readonly studentId: string | null;
  /** Заполнен для преподавателей (кабинет преподавателя — P2). */
  readonly teacherId: string | null;
}

/** Метаданные сессии (без токена и хеша). */
export interface SessionInfo {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Валидная сессия: пользователь + запись сессии. */
export interface AuthSession {
  readonly user: SessionUser;
  readonly session: SessionInfo;
}

export interface CreateSessionMeta {
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface CreateSessionResult {
  /** Токен для cookie. В базе не хранится — только его sha256. */
  readonly token: string;
  readonly session: SessionInfo;
}

/** Генерирует токен сессии (base64url, 256 бит). */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * Создаёт сессию пользователя. Метаданные (ip, userAgent) ограничены
 * по длине: в БД они идут как есть, обрезаем на границе.
 */
export async function createSession(
  userId: string,
  meta: CreateSessionMeta = {},
): Promise<CreateSessionResult> {
  if (typeof userId !== 'string' || userId === '') {
    throw new TypeError('userId обязателен для создания сессии.');
  }
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + sessionTtlDays() * SECONDS_PER_DAY * 1000);

  const record = await prisma().session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ip: truncate(meta.ip, 64),
      userAgent: truncate(meta.userAgent, 256),
    },
  });

  return { token, session: toSessionInfo(record) };
}

/**
 * Проверяет токен сессии.
 *
 * Возвращает null (не бросает) для неизвестного или просроченного токена.
 * Просроченную сессию удаляет — чтобы таблица не росла и чтобы
 * компрометированный токен не мог быть «оживлён».
 */
export async function validateSession(token: string): Promise<AuthSession | null> {
  if (typeof token !== 'string' || token === '') {
    return null;
  }

  const record = await prisma().session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          login: true,
          role: true,
          student: { select: { id: true } },
          teacher: { select: { id: true } },
        },
      },
    },
  });

  if (record === null) {
    return null;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma().session.deleteMany({ where: { id: record.id } });
    return null;
  }

  return {
    user: {
      id: record.user.id,
      login: record.user.login,
      role: record.user.role,
      studentId: record.user.student?.id ?? null,
      teacherId: record.user.teacher?.id ?? null,
    },
    session: toSessionInfo(record),
  };
}

/** Отзывает сессию по токену (выход из аккаунта). */
export async function revokeSession(token: string): Promise<void> {
  if (typeof token !== 'string' || token === '') {
    return;
  }
  await prisma().session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

/** Отзывает все сессии пользователя (смена пароля, подозрительная активность). */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  if (typeof userId !== 'string' || userId === '') {
    return 0;
  }
  const result = await prisma().session.deleteMany({ where: { userId } });
  return result.count;
}

function truncate(value: string | undefined, maxLength: number): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function toSessionInfo(record: {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
}): SessionInfo {
  return {
    id: record.id,
    userId: record.userId,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    ip: record.ip,
    userAgent: record.userAgent,
  };
}

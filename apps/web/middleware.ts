/**
 * Middleware apps/web: безопасность на каждом ответе + гейтинг кабинета.
 *
 * 1. ЗАГОЛОВКИ БЕЗОПАСНОСТИ — на каждый ответ, проходящий через
 *    middleware (кроме служебной статики Next, см. matcher):
 *    - CSP: строгая, но рабочая для Next.js (инлайновые стили/скрипты
 *      этапа разработки разрешены осознанно; connect-src только 'self');
 *    - HSTS — ТОЛЬКО в продакшне: на http://localhost браузер игнорирует
 *      заголовок, а на проде он фиксирует HTTPS на 2 года;
 *    - X-Frame-Options DENY + frame-ancestors 'none' — кликджекинг;
 *    - nosniff, Referrer-Policy, Permissions-Policy (камера — только
 *      'self' для съёмки фото студбилета; микрофон и геолокация — 'none').
 *
 * 2. СЕССИЯ — cookie читается и валидируется боевым validateSession из
 *    packages/core (middleware работает в Node-runtime, поэтому нативный
 *    argon2 и Prisma доступны). Решение прокидывается дальше:
 *    - /api/* закрыты для анонимов, КРОМЕ публичных точек входа
 *      (/api/auth/login, /api/auth/oauth/*, /api/health) и выдачи
 *      CSRF-токена (/api/auth/csrf — без неё клиент не сможет получить
 *      токен до входа, паттерн «двойная отправка» требует публичной выдачи);
 *    - страницы кабинета закрыты: аноним → редирект на /login;
 *    - /staff и /admin: роль STUDENT → 404 (не 403! требование
 *      ACCEPTANCE: студент не должен даже узнавать, что раздел есть).
 *
 * 3. CSRF — все изменяющие запросы (POST/PUT/PATCH/DELETE) к /api/*
 *    требуют заголовок X-CSRF-Token, равный cookie udgu_csrf
 *    (сравнение timingSafeEqual в packages/core). Исключения — точки
 *    входа, где сессии ещё нет: login и oauth/* защищены иначе
 *    (SameSite=Lax + одноразовый state). Без токена → 403.
 *
 * ВАЖНО: middleware валидирует сессию для ГЕЙТИНГА. Маршруты заново
 * резолвят сессию из cookie (lib/session.ts) — решения об авторизации
 * принимаются в одном месте и не зависят от прошедшего гейта.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  parseCookieValue,
  validateSession,
  verifyCsrfToken,
  csrfCookieName,
  sessionCookieName,
  CSRF_HEADER_NAME,
} from '@udgu/core';
import { jsonError } from './lib/http';

/** Node-runtime обязателен: validateSession тянет Prisma и argon2. */
export const runtime = 'nodejs';

/** Страницы личного кабинета студента (закрыты для анонимов). */
const CABINET_PAGES = [
  '/dashboard',
  '/profile',
  '/schedule',
  '/grades',
  '/requests',
  '/notifications',
  '/announcements',
  '/sick-leave',
  '/verification',
  '/teachers',
] as const;

/** Страницы сотрудника деканата (роль STUDENT получает 404). */
const STAFF_PAGES = ['/staff', '/admin'] as const;

/**
 * Публичные точки API: сессия не требуется.
 * /api/auth/csrf — выдача CSRF-токена до входа (см. комментарий файла).
 */
function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === '/api/auth/login' ||
    pathname.startsWith('/api/auth/oauth/') ||
    pathname === '/api/auth/csrf' ||
    pathname === '/api/health'
  );
}

/** Изменяющие методы — только с CSRF-токеном. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Заголовки безопасности на ответ (HSTS — только в продакшне). */
function applySecurityHeaders(response: NextResponse): NextResponse {
  const headers = response.headers;
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  if (process.env.NODE_ENV === 'production') {
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', "camera 'self', microphone 'none', geolocation 'none'");
  return response;
}

/** Ответ «не найдено» для страниц, скрытых от студента (не 403). */
function notFoundResponse(): NextResponse {
  return applySecurityHeaders(
    new NextResponse('Страница не найдена.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
  );
}

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Сессия: cookie → validateSession (null для анонима/просроченной).
  const token = parseCookieValue(request.headers.get('cookie'), sessionCookieName());
  const session = token === null ? null : await validateSession(token);
  const role = session?.user.role ?? null;

  // ---- API ----
  if (pathname.startsWith('/api/')) {
    if (!isPublicApiPath(pathname) && session === null) {
      return applySecurityHeaders(jsonError(401, 'UNAUTHENTICATED', 'Требуется вход в систему.'));
    }
    if (
      !isPublicApiPath(pathname) &&
      MUTATING_METHODS.has(request.method) &&
      !hasValidCsrf(request)
    ) {
      return applySecurityHeaders(
        jsonError(403, 'CSRF_INVALID', 'Запрос отклонён: устарел или отсутствует CSRF-токен. Обновите страницу.'),
      );
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // ---- Кабинет сотрудника: студент не знает, что раздел существует ----
  if (startsWithAny(pathname, STAFF_PAGES)) {
    if (role === 'STUDENT') {
      return notFoundResponse();
    }
    if (role === null) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL('/login', request.url)),
      );
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // ---- Страницы кабинета студента ----
  // Корень «/» — экран «Сегодня» (route group (cabinet)/page.tsx), поэтому
  // проверяем точным совпадением: startsWith('/') захватил бы все пути.
  if (pathname === '/' || startsWithAny(pathname, CABINET_PAGES)) {
    if (session === null) {
      return applySecurityHeaders(NextResponse.redirect(new URL('/login', request.url)));
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // Остальные страницы (вход, регистрация, ошибки) — только заголовки.
  return applySecurityHeaders(NextResponse.next());
}

/** Двойная отправка CSRF: заголовок X-CSRF-Token == cookie udgu_csrf. */
function hasValidCsrf(request: NextRequest): boolean {
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  const cookieToken = parseCookieValue(request.headers.get('cookie'), csrfCookieName());
  return verifyCsrfToken(headerToken, cookieToken);
}

export const config = {
  matcher: [
    // Все страницы и API, кроме внутренней статики Next и файлов в public.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

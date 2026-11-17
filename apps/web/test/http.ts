/**
 * Вызов маршрутов apps/web в тестах: собирает NextRequest с cookie,
 * вызывает обработчик и отдаёт ответ + удобные accessors.
 *
 * Обработчик вызывается напрямую (без сети): тест проверяет тот же код,
 * что и продакшен, но без dev-сервера. Гейтинг middleware проверяется
 * отдельными тестами через сам middleware.
 */
import { NextRequest } from 'next/server';
import { csrfCookieName, sessionCookieName, CSRF_HEADER_NAME } from '@udgu/core';

export interface RouteResponse {
  readonly response: Response;
  status(): number;
  json<T = Record<string, unknown>>(): Promise<T>;
  cookie(name: string): string | undefined;
}

function wrap(response: Response): RouteResponse {
  // Тело ответа читается один раз (Body нельзя читать повторно) —
  // кешируем разобранный JSON, чтобы тест мог спокойно обращаться
  // к разным частям ответа.
  let parsedBody: Promise<unknown> | null = null;
  return {
    response,
    status: () => response.status,
    json: async <T,>(): Promise<T> => {
      parsedBody ??= response.json();
      return (await parsedBody) as T;
    },
    cookie: (name: string) => {
      // NextResponse.cookies корректно разбирает несколько Set-Cookie
      // (у cookie сессии в Expires есть запятая — склейка заголовка
      // сломала бы наивный разбор).
      const cookies = (response as unknown as { cookies?: { get(n: string): { value: string } | undefined } }).cookies;
      return cookies?.get(name)?.value;
    },
  };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  /** IP клиента (для rate-limit на вход). */
  ip?: string;
}

/** Собирает NextRequest для маршрута apps/web. */
export function apiRequest(path: string, options: RequestOptions = {}): NextRequest {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };

  const cookieParts: string[] = [];
  for (const [name, value] of Object.entries(options.cookies ?? {})) {
    cookieParts.push(`${name}=${value}`);
  }
  if (cookieParts.length > 0) {
    headers.cookie = cookieParts.join('; ');
  }
  if (options.ip !== undefined) {
    headers['x-forwarded-for'] = options.ip;
  }

  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  return new NextRequest(`http://localhost${path}`, { method, headers, body });
}

/** Cookie сессии и CSRF из ответа (для цепочки «вошли → сделали POST»). */
export function sessionCookiesFrom(response: Response): { session?: string; csrf?: string } {
  const cookies = (response as unknown as { cookies?: { get(n: string): { value: string } | undefined } }).cookies;
  return {
    session: cookies?.get(sessionCookieName())?.value,
    csrf: cookies?.get(csrfCookieName())?.value,
  };
}

/** Заголовок CSRF для защищённого POST. */
export function csrfHeader(token: string): Record<string, string> {
  return { [CSRF_HEADER_NAME]: token };
}

/** Вызывает обработчик маршрута и оборачивает ответ. */
export async function callRoute(
  handler: (request: NextRequest, context?: never) => Promise<Response> | Response,
  request: NextRequest,
): Promise<RouteResponse> {
  return wrap(await handler(request));
}

/**
 * Вызывает динамический маршрут (с params). Параметр типа фиксирует
 * форму params конкретного маршрута ([id] → { id: string }).
 */
export async function callRouteWithParams<T extends Record<string, string>>(
  handler: (
    request: NextRequest,
    context: { params: Promise<T> },
  ) => Promise<Response> | Response,
  request: NextRequest,
  params: T,
): Promise<RouteResponse> {
  return wrap(await handler(request, { params: Promise.resolve(params) }));
}

/** Разобранный JSON ответа (сырой Response.json() не типизирован). */
export async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

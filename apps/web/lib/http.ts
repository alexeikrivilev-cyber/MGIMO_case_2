/**
 * HTTP-помощники маршрутов apps/web: метаданные запроса (IP, User-Agent),
 * разбор JSON/query по zod-схемам и единый формат ошибок.
 *
 * Формат ошибки (ARCHITECTURE §4, требование кейса «общие сообщения»):
 *   { "error": { "code": "MACHINE_CODE", "message": "…", "details": ["…"] } }
 * message намеренно обобщён и не раскрывает, существует ли запрошенный
 * объект; details — только сообщения уровня формы (поле: причина),
 * без внутренних путей и значений.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ValidationError, firstIssues } from '@udgu/core';

/** Машинные коды ошибок API (для клиента и тестов). */
export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'CSRF_INVALID'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERIFICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'INTERNAL';

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode | string;
    readonly message: string;
    readonly details?: readonly string[];
  };
}

/** JSON-ответ с ошибкой в едином формате. */
export function jsonError(
  status: number,
  code: ApiErrorCode | string,
  message: string,
  details?: readonly string[],
): NextResponse {
  const body: ApiErrorBody =
    details === undefined || details.length === 0
      ? { error: { code, message } }
      : { error: { code, message, details } };
  return NextResponse.json(body, { status });
}

/**
 * IP клиента для rate-limit и аудита. За обратным прокси (docker/compose,
 * Helsinki VPS + nginx) реальный адрес — в X-Forwarded-For; берём ПЕРВЫЙ
 * адрес цепочки (его подделывает только сам клиент, остальные добавляют
 * доверенные прокси). Без заголовка — прямое соединение.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') {
      return first.slice(0, 64);
    }
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp !== null && realIp.trim() !== '') {
    return realIp.trim().slice(0, 64);
  }
  return '127.0.0.1';
}

/** User-Agent запроса (обрезается при записи в сессию/аудит). */
export function userAgent(request: NextRequest): string | undefined {
  return request.headers.get('user-agent') ?? undefined;
}

/**
 * Разбирает JSON-тело по zod-схеме. Некорректный JSON или нарушение
 * схемы → ValidationError INVALID_INPUT (400) с сообщениями формы.
 */
export async function parseJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError('INVALID_INPUT', 'Ожидался корректный JSON в теле запроса.');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные запроса.', firstIssues(parsed.error));
  }
  return parsed.data;
}

/**
 * Разбирает query-строку по схеме. Пустая строка параметров — не ошибка:
 * схема сама задаёт значения по умолчанию.
 */
export function parseQuery<T>(request: NextRequest, schema: z.ZodType<T>): T {
  const raw: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные параметры запроса.', firstIssues(parsed.error));
  }
  return parsed.data;
}

/**
 * Разбирает необязательное JSON-тело: пустое тело (POST без данных) —
 * не ошибка, подставляется значение default схемы. Нужно маршрутам
 * вида «начало OAuth-согласия», где все поля формы необязательны.
 */
export async function parseOptionalJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await request.text();
  if (text.trim() === '') {
    const parsed = schema.safeParse(undefined);
    if (!parsed.success) {
      throw new ValidationError('INVALID_INPUT', 'Некорректные данные запроса.', firstIssues(parsed.error));
    }
    return parsed.data;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ValidationError('INVALID_INPUT', 'Ожидался корректный JSON в теле запроса.');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные запроса.', firstIssues(parsed.error));
  }
  return parsed.data;
}

/** Параметр пути: непустая строка (идентификатор сущности). */
export function pathParam(value: string | undefined, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('INVALID_INPUT', `Идентификатор «${what}» не указан.`);
  }
  return value.trim();
}

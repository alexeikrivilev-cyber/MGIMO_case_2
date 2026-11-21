/**
 * Rate-limit действий кабинета (ARCHITECTURE §4): 30 POST-действий
 * за минуту на пару (раздел-bucket, пользователь сессии).
 *
 * Счётчики живут в packages/core (ratelimit.ts) — единая реализация
 * для API и будущих поверхностей. Ключ «bucket:userId»: лимит
 * привязан к пользователю СЕССИИ (никогда к телу запроса) и считается
 * отдельно по каждому разделу — диалог с ассистентом не съедает
 * лимит заявок.
 *
 * Применять сразу ПОСЛЕ requireSession в POST-обработчиках: до разбора
 * тела и любой работы с БД. Отказ — 429 с машинным кодом RATE_LIMITED
 * и заголовком Retry-After (секунды до разблокировки). Ограничение
 * намеренно мягкое: живой студент не отправит 30 заявок за минуту, а
 * флуд/спам с одного аккаунта останавливается.
 *
 * ВАЖНО (эксплуатация): счётчики in-memory и при нескольких инстансах
 * считаются на каждый отдельно — см. предупреждение в packages/core
 * ratelimit.ts (перед продакшеном — Redis).
 */
import { NextResponse } from 'next/server';
import type { AuthSession } from '@udgu/core';
import { checkSessionRateLimit, recordSessionAction } from '@udgu/core';
import { jsonError } from './http';

/**
 * Проверяет лимит действий сессии в разделе `bucket`.
 *
 * Отказ → готовый ответ 429 (RATE_LIMITED, Retry-After) — маршрут
 * возвращает его как есть. Успех → действие фиксируется в счётчике,
 * возвращается null, и маршрут продолжает работу.
 */
export function enforceSessionRateLimit(session: AuthSession, bucket: string): NextResponse | null {
  const key = `${bucket}:${session.user.id}`;
  const limit = checkSessionRateLimit(key);
  if (!limit.allowed) {
    const response = jsonError(429, 'RATE_LIMITED', 'Слишком часто. Попробуйте через минуту.');
    response.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return response;
  }
  recordSessionAction(key);
  return null;
}

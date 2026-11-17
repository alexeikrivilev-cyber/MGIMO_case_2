/**
 * Rate-limit на вход: 5 неуспешных попыток за 15 минут на пару (логин, IP).
 *
 * Хранилище — in-memory Map со скользящим окном. ВАЖНО (эксплуатация):
 * в продакшне приложение работает в нескольких инстансах (Docker,
 * горизонтальный рост), и in-memory счётчики считаются на каждый
 * инстант отдельно — атакующий обходит лимит, распределяя попытки.
 * Перед продакшеном счётчики нужно перенести в Redis (инкремент со
 * скользящим окном, например sorted set по timestamp), оставив этот
 * модуль как fallback для одного инстанса и для тестов. Интерфейс
 * (checkLoginRateLimit/recordLoginAttempt) от этого не меняется.
 *
 * Успешный вход сбрасывает счётчик пары — легальный пользователь не
 * должен «залипнуть» в блокировке после одной опечатки.
 */

/** Максимум неуспешных попыток входа в окне. */
export const MAX_LOGIN_ATTEMPTS = 5;

/** Окно попыток, миллисекунды (15 минут). */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Ключ счётчика: логин в нижнем регистре + IP. */
function attemptKey(login: string, ip: string): string {
  return `${login.trim().toLowerCase()}|${ip.trim()}`;
}

/** Времена неуспешных попыток по ключу (timestamp, мс). */
const attemptsByKey = new Map<string, number[]>();

/** Время последней полной очистки устаревших ключей. */
let lastCleanupAt = 0;

/** Удаляет записи, все попытки которых вышли за окно (освобождение памяти). */
function cleanupExpired(now: number): void {
  for (const [key, timestamps] of attemptsByKey) {
    const alive = timestamps.filter((time) => time > now - LOGIN_WINDOW_MS);
    if (alive.length === 0) {
      attemptsByKey.delete(key);
    } else {
      attemptsByKey.set(key, alive);
    }
  }
}

function pruneAndCount(key: string, now: number): number[] {
  const timestamps = attemptsByKey.get(key) ?? [];
  const alive = timestamps.filter((time) => time > now - LOGIN_WINDOW_MS);
  if (alive.length === 0) {
    attemptsByKey.delete(key);
    return [];
  }
  attemptsByKey.set(key, alive);
  return alive;
}

export interface LoginRateLimitResult {
  /** Разрешена ли попытка входа. */
  readonly allowed: boolean;
  /** Через сколько секунд можно пробовать снова (0, если вход разрешён). */
  readonly retryAfterSeconds: number;
}

/**
 * Проверяет, не заблокирована ли пара (логин, IP).
 * `now` инжектируется для тестов — в проде используется системное время.
 */
export function checkLoginRateLimit(
  login: string,
  ip: string,
  now: number = Date.now(),
): LoginRateLimitResult {
  maybeCleanup(now);

  const key = attemptKey(login, ip);
  const alive = pruneAndCount(key, now);

  if (alive.length < MAX_LOGIN_ATTEMPTS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Самая старая попытка в окне определяет момент разблокировки.
  const oldest = Math.min(...alive);
  const unblockAt = oldest + LOGIN_WINDOW_MS;
  const retryAfterMs = Math.max(0, unblockAt - now);
  return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
}

/**
 * Фиксирует попытку входа. success=true сбрасывает счётчик пары.
 * `now` инжектируется для тестов.
 */
export function recordLoginAttempt(
  login: string,
  ip: string,
  success: boolean,
  now: number = Date.now(),
): void {
  maybeCleanup(now);

  const key = attemptKey(login, ip);
  if (success) {
    attemptsByKey.delete(key);
    return;
  }

  const alive = pruneAndCount(key, now);
  alive.push(now);
  attemptsByKey.set(key, alive);
}

function maybeCleanup(now: number): void {
  // Полная очистка — не чаще одного раза за окно: на каждом обращении
  // и так происходит «подрезка» ключа (pruneAndCount), поэтому часто
  // запускать сборщик мусора незачем.
  if (now - lastCleanupAt < LOGIN_WINDOW_MS) {
    return;
  }
  lastCleanupAt = now;
  cleanupExpired(now);
}

/**
 * Полный сброс счётчиков. Нужен тестам и операциям «разблокировать
 * пользователя» (в проде — аналог `DEL login:*` в Redis).
 */
export function resetLoginRateLimit(): void {
  attemptsByKey.clear();
  lastCleanupAt = 0;
}

/** Текущее число неуспешных попыток в окне (для тестов и админки). */
export function loginAttemptsLeft(login: string, ip: string, now: number = Date.now()): number {
  const alive = pruneAndCount(attemptKey(login, ip), now);
  return Math.max(0, MAX_LOGIN_ATTEMPTS - alive.length);
}

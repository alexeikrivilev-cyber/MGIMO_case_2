/**
 * Тесты rate-limit входа: 5 неуспешных попыток / 15 минут на пару
 * (логин, IP). Часы инжектируются — без sleep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
  resetLoginRateLimit,
  loginAttemptsLeft,
  MAX_LOGIN_ATTEMPTS,
  LOGIN_WINDOW_MS,
} from '../src/index.js';

const LOGIN = 'student1';
const IP = '10.0.0.7';

const T0 = 1_800_000_000_000; // фиксированный «сейчас» в мс
const MINUTE = 60 * 1000;

test.before(() => {
  resetLoginRateLimit();
});

test('пять неуспешных попыток разрешены, шестая заблокирована', () => {
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
    assert.equal(
      checkLoginRateLimit(LOGIN, IP, T0).allowed,
      true,
      `попытка ${attempt + 1} должна быть разрешена`,
    );
    recordLoginAttempt(LOGIN, IP, false, T0 + attempt);
  }

  const blocked = checkLoginRateLimit(LOGIN, IP, T0 + MAX_LOGIN_ATTEMPTS);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0, 'возвращается время ожидания');
  assert.equal(loginAttemptsLeft(LOGIN, IP, T0), 0);
});

test('retryAfterSeconds отсчитывается от самой старой попытки в окне', () => {
  resetLoginRateLimit();
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
    recordLoginAttempt(LOGIN, IP, false, T0 + attempt * 1000);
  }

  // Первая попытка в T0, окно 15 минут → разблокировка в T0+15мин.
  const atTenMinutes = checkLoginRateLimit(LOGIN, IP, T0 + 10 * MINUTE);
  assert.equal(atTenMinutes.allowed, false);
  assert.equal(atTenMinutes.retryAfterSeconds, 5 * 60);

  const afterWindow = checkLoginRateLimit(LOGIN, IP, T0 + LOGIN_WINDOW_MS + 1);
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.retryAfterSeconds, 0);
});

test('успешный вход сбрасывает счётчик', () => {
  resetLoginRateLimit();
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS - 1; attempt += 1) {
    recordLoginAttempt(LOGIN, IP, false, T0 + attempt);
  }
  assert.equal(checkLoginRateLimit(LOGIN, IP, T0).allowed, true);

  recordLoginAttempt(LOGIN, IP, true, T0 + 10);

  assert.equal(checkLoginRateLimit(LOGIN, IP, T0 + 11).allowed, true);
  assert.equal(loginAttemptsLeft(LOGIN, IP, T0 + 11), MAX_LOGIN_ATTEMPTS);
});

test('успешный вход разблокирует даже после блокировки', () => {
  resetLoginRateLimit();
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
    recordLoginAttempt(LOGIN, IP, false, T0 + attempt);
  }
  assert.equal(checkLoginRateLimit(LOGIN, IP, T0).allowed, false);

  // Пользователь всё же вошёл (например, с другого IP после сброса
  // пароля) — счётчик для пары обнуляется.
  recordLoginAttempt(LOGIN, IP, true, T0 + MINUTE);
  assert.equal(checkLoginRateLimit(LOGIN, IP, T0 + 2 * MINUTE).allowed, true);
});

test('окно скользящее: попытки старше 15 минут не блокируют', () => {
  resetLoginRateLimit();
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
    // Пять неуспешных попыток, растянутых на 15 минут.
    recordLoginAttempt(LOGIN, IP, false, T0 + attempt * 4 * MINUTE);
  }

  // Самая старая попытка (T0) выпала из окна: T0+16мин - 15мин = T0+1мин,
  // в окне остаются 4 попытки из 5.
  const afterSlide = checkLoginRateLimit(LOGIN, IP, T0 + 16 * MINUTE);
  assert.equal(afterSlide.allowed, true);
  assert.equal(loginAttemptsLeft(LOGIN, IP, T0 + 16 * MINUTE), MAX_LOGIN_ATTEMPTS - 4);
});

test('счётчики раздельны по логину и по IP', () => {
  resetLoginRateLimit();
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
    recordLoginRateLimitAttempt(attempt);
  }
  assert.equal(checkLoginRateLimit(LOGIN, IP, T0).allowed, false);

  // Другой логин с того же IP — не заблокирован.
  assert.equal(checkLoginRateLimit('student2', IP, T0).allowed, true);
  // Тот же логин с другого IP — не заблокирован.
  assert.equal(checkLoginRateLimit(LOGIN, '10.0.0.99', T0).allowed, true);
  // Регистр логина не влияет на ключ.
  assert.equal(checkLoginRateLimit('STUDENT1', IP, T0).allowed, false);
});

test('устаревшие записи очищаются (память не течёт)', () => {
  resetLoginRateLimit();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    recordLoginAttempt(`ghost-${attempt}`, IP, false, T0);
  }
  // Одна неуспешная попытка → осталось 4 из 5.
  assert.equal(loginAttemptsLeft('ghost-0', IP, T0), MAX_LOGIN_ATTEMPTS - 1);

  // Любой вызов после окна запускает очистку устаревших ключей.
  checkLoginRateLimit('other', 'other-ip', T0 + LOGIN_WINDOW_MS + 1);
  checkLoginRateLimit('other', 'other-ip', T0 + LOGIN_WINDOW_MS + 2);
  checkLoginRateLimit('other', 'other-ip', T0 + LOGIN_WINDOW_MS + 3);

  // Все записи ghost-* вычищены: счётчики снова полные.
  assert.equal(loginAttemptsLeft('ghost-0', IP, T0 + LOGIN_WINDOW_MS + 3), MAX_LOGIN_ATTEMPTS);
});

test('resetLoginRateLimit полностью обнуляет состояние', () => {
  for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt += 1) {
    recordLoginAttempt(LOGIN, IP, false, T0 + attempt);
  }
  resetLoginRateLimit();
  assert.equal(checkLoginRateLimit(LOGIN, IP, T0).allowed, true);
});

function recordLoginRateLimitAttempt(index: number): void {
  recordLoginAttempt(LOGIN, IP, false, T0 + index);
}

/**
 * Тесты сессий: создание/валидация, истечение, отзыв, cookie-флаги, CSRF.
 *
 * Используется отдельная тестовая база (см. helpers.ts): прод-база
 * не трогается. Токен в базе представлен только sha256-хешем —
 * это проверяется явно.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  generateCsrfToken,
  verifyCsrfToken,
  buildSessionCookie,
  buildExpiredSessionCookie,
  buildCsrfCookie,
  parseCookieValue,
  sessionCookieName,
  csrfCookieName,
  sessionCookieAttributes,
  sessionMaxAgeSeconds,
  isSecureCookie,
  DEFAULT_SESSION_TTL_DAYS,
  DEFAULT_SESSION_COOKIE_NAME,
  DEFAULT_CSRF_COOKIE_NAME,
  SESSION_TOKEN_BYTES,
} from '../src/index.js';
import { prisma } from '../src/db.js';
import {
  resetTestData,
  closeTestDb,
  createUser,
  createGroup,
  createStudent,
} from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

test.before(async () => {
  await resetTestData();
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('createSession → validateSession: roundtrip и состав сессии', async () => {
  const group = await createGroup('СЕС-11-1');
  const student = await createStudent('student-session', group.id);

  const { token, session } = await createSession(student.userId, {
    ip: '10.1.1.1',
    userAgent: 'Mozilla/5.0 (test)',
  });

  // Токен — 32 байта в base64url.
  const raw = Buffer.from(token, 'base64url');
  assert.equal(raw.byteLength, SESSION_TOKEN_BYTES);
  assert.match(token, /^[A-Za-z0-9_-]+$/);

  const validated = await validateSession(token);
  assert.ok(validated !== null, 'сессия валидна');
  assert.equal(validated.user.id, student.userId);
  assert.equal(validated.user.login, 'student-session');
  assert.equal(validated.user.role, 'STUDENT');
  assert.equal(validated.user.studentId, student.studentId, 'studentId резолвится из БД');
  assert.equal(validated.session.id, session.id);
  assert.equal(validated.session.ip, '10.1.1.1');
  assert.equal(validated.session.userAgent, 'Mozilla/5.0 (test)');

  // Срок жизни по умолчанию — 7 дней.
  const ttl = validated.session.expiresAt.getTime() - validated.session.createdAt.getTime();
  assert.ok(Math.abs(ttl - DEFAULT_SESSION_TTL_DAYS * DAY_MS) < 2000, 'TTL ≈ 7 дней');
});

test('в базе хранится только sha256-хеш токена', async () => {
  const user = await createUser('student-hash', 'STUDENT');
  const { token } = await createSession(user.id);

  const rows = await prisma().session.findMany({ where: { userId: user.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(rows).includes(token), 'сырой токен в БД отсутствует');
});

test('неверный токен → null', async () => {
  const user = await createUser('student-bad', 'STUDENT');
  await createSession(user.id);

  assert.equal(await validateSession('не-токен'), null);
  assert.equal(await validateSession(''), null);
  assert.equal(
    await validateSession(Buffer.alloc(32, 7).toString('base64url')),
    null,
    'случайный валидный по форме токен не проходит',
  );
});

test('просроченная сессия → null и удалена из базы', async () => {
  const user = await createUser('student-expired', 'STUDENT');
  const { token } = await createSession(user.id);

  // Искусственно «старим» сессию: срок вышел вчера.
  await prisma().session.updateMany({
    where: { userId: user.id },
    data: { expiresAt: new Date(Date.now() - DAY_MS) },
  });

  assert.equal(await validateSession(token), null);
  const left = await prisma().session.count({ where: { userId: user.id } });
  assert.equal(left, 0, 'просроченная сессия удалена');
});

test('SESSION_TTL_DAYS из окружения настраивает срок жизни', async () => {
  const user = await createUser('student-ttl', 'STUDENT');
  const previous = process.env.SESSION_TTL_DAYS;
  process.env.SESSION_TTL_DAYS = '2';
  try {
    const { session } = await createSession(user.id);
    const ttl = session.expiresAt.getTime() - Date.now();
    assert.ok(Math.abs(ttl - 2 * DAY_MS) < 2000, 'TTL ≈ 2 дня');
    assert.equal(sessionMaxAgeSeconds(), 2 * 24 * 60 * 60);
  } finally {
    if (previous === undefined) {
      delete process.env.SESSION_TTL_DAYS;
    } else {
      process.env.SESSION_TTL_DAYS = previous;
    }
  }
});

test('SESSION_TTL_DAYS: мусорное значение не роняет создание сессии', async () => {
  const user = await createUser('student-ttl-bad', 'STUDENT');
  const previous = process.env.SESSION_TTL_DAYS;
  process.env.SESSION_TTL_DAYS = 'сорок';
  try {
    const { session } = await createSession(user.id);
    const ttl = session.expiresAt.getTime() - Date.now();
    assert.ok(Math.abs(ttl - DEFAULT_SESSION_TTL_DAYS * DAY_MS) < 2000, 'откат на 7 дней');
  } finally {
    if (previous === undefined) {
      delete process.env.SESSION_TTL_DAYS;
    } else {
      process.env.SESSION_TTL_DAYS = previous;
    }
  }
});

test('revokeSession отзывает одну сессию', async () => {
  const user = await createUser('student-revoke', 'STUDENT');
  const first = await createSession(user.id);
  const second = await createSession(user.id);

  await revokeSession(first.token);

  assert.equal(await validateSession(first.token), null);
  assert.ok((await validateSession(second.token)) !== null, 'вторая сессия жива');
});

test('revokeAllUserSessions отзывает все сессии пользователя', async () => {
  const user = await createUser('student-revoke-all', 'STUDENT');
  const other = await createUser('student-keep', 'STUDENT');
  const first = await createSession(user.id);
  const second = await createSession(user.id);
  const otherSession = await createSession(other.id);

  const revoked = await revokeAllUserSessions(user.id);
  assert.equal(revoked, 2);

  assert.equal(await validateSession(first.token), null);
  assert.equal(await validateSession(second.token), null);
  assert.ok((await validateSession(otherSession.token)) !== null, 'чужой пользователь не затронут');
});

// ---------------------------------------------------------------------------
// Cookie-хелперы (чистые функции, без Next.js)
// ---------------------------------------------------------------------------

test('cookie сессии: httpOnly, sameSite lax, path /, secure по NODE_ENV', () => {
  const attributes = sessionCookieAttributes();
  assert.equal(attributes.httpOnly, true);
  assert.equal(attributes.sameSite, 'lax');
  assert.equal(attributes.path, '/');
  assert.equal(isSecureCookie(), false, 'в тестовом окружении Secure выключен');

  const cookie = buildSessionCookie('token-value');
  assert.match(cookie, /^udgu_session=token-value/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=604800/);
  assert.doesNotMatch(cookie, /Secure/, 'без Secure вне продакшена');

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const secureCookie = buildSessionCookie('token-value');
    assert.match(secureCookie, /Secure/, 'в продакшене Secure включается');
    assert.equal(isSecureCookie(), true);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

/**
 * РЕГРЕССИЯ (найдена при выкладке на Helsinki VPS): приложение отдавалось по
 * plain HTTP (до подключения домена и до открытия портов 80/443 в ufw), а
 * cookie сессии имела флаг Secure, потому что NODE_ENV=production. Браузер и
 * curl НЕ отправляют Secure-cookie по HTTP — поэтому каждый запрос выглядел
 * анонимным: /staff отдавал 307 вместо 404, /api/grades — 401 вместо данных.
 *
 * Окружение production != окружение HTTPS. Флаг Secure должен управляться
 * явно: SESSION_COOKIE_SECURE=true/false, и только затем NODE_ENV.
 */
test('Secure-cookie: явный opt-out через SESSION_COOKIE_SECURE=false', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousFlag = process.env.SESSION_COOKIE_SECURE;
  process.env.NODE_ENV = 'production';
  try {
    // По умолчанию в продакшене Secure включён (безопасное значение).
    delete process.env.SESSION_COOKIE_SECURE;
    assert.equal(isSecureCookie(), true, 'в продакшене Secure включён по умолчанию');

    // Явный opt-out — когда сервис временно работает по HTTP.
    process.env.SESSION_COOKIE_SECURE = 'false';
    assert.equal(isSecureCookie(), false);
    assert.doesNotMatch(buildSessionCookie('t'), /Secure/, 'по HTTP Secure выключен');

    // Явный opt-in перебивает и development.
    process.env.SESSION_COOKIE_SECURE = 'true';
    assert.equal(isSecureCookie(), true);
    assert.match(buildSessionCookie('t'), /Secure/);
  } finally {
    process.env.NODE_ENV = previousEnv;
    if (previousFlag === undefined) {
      delete process.env.SESSION_COOKIE_SECURE;
    } else {
      process.env.SESSION_COOKIE_SECURE = previousFlag;
    }
  }
});

test('имена cookie и удаление сессии', () => {
  assert.equal(sessionCookieName(), DEFAULT_SESSION_COOKIE_NAME);
  assert.equal(csrfCookieName(), DEFAULT_CSRF_COOKIE_NAME);

  const previousName = process.env.SESSION_COOKIE_NAME;
  process.env.SESSION_COOKIE_NAME = 'udgu_test_session';
  try {
    assert.equal(sessionCookieName(), 'udgu_test_session');
    assert.match(buildSessionCookie('t'), /^udgu_test_session=t/);
  } finally {
    if (previousName === undefined) {
      delete process.env.SESSION_COOKIE_NAME;
    } else {
      process.env.SESSION_COOKIE_NAME = previousName;
    }
  }

  const cleared = buildExpiredSessionCookie();
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /SameSite=Lax/);
});

test('CSRF-cookie читается клиентом (без HttpOnly) — двойная отправка', () => {
  const token = generateCsrfToken();
  const cookie = buildCsrfCookie(token);

  assert.match(cookie, /^udgu_csrf=/);
  assert.doesNotMatch(cookie, /HttpOnly/, 'иначе JS не продублирует токен в заголовок');
  assert.match(cookie, /SameSite=Lax/);
});

test('parseCookieValue достаёт значение по имени', () => {
  const header = 'other=1; udgu_session=abc123; udgu_csrf=xyz';
  assert.equal(parseCookieValue(header, 'udgu_session'), 'abc123');
  assert.equal(parseCookieValue(header, 'udgu_csrf'), 'xyz');
  assert.equal(parseCookieValue(header, 'missing'), null);
  assert.equal(parseCookieValue(null, 'udgu_session'), null);
  assert.equal(parseCookieValue(undefined, 'udgu_session'), null);
  assert.equal(parseCookieValue('udgu_session=', 'udgu_session'), null);
});

test('CSRF: верный токен проходит, неверный — нет', () => {
  const expected = generateCsrfToken();

  assert.equal(verifyCsrfToken(expected, expected), true);
  assert.equal(verifyCsrfToken(expected, generateCsrfToken()), false);
  assert.equal(verifyCsrfToken(expected, ''), false);
  assert.equal(verifyCsrfToken('', expected), false);
  assert.equal(verifyCsrfToken(undefined, expected), false);
  assert.equal(verifyCsrfToken(expected, null), false);
  assert.equal(verifyCsrfToken(`${expected}x`, expected), false, 'разная длина → false');
  assert.equal(verifyCsrfToken(expected, `${expected}x`), false);
});

test('CSRF-токены не повторяются между вызовами', () => {
  const tokens = new Set(Array.from({ length: 20 }, () => generateCsrfToken()));
  assert.equal(tokens.size, 20);
  for (const token of tokens) {
    assert.ok(Buffer.from(token, 'base64url').byteLength === 32);
  }
});

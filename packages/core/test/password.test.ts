/**
 * Тесты argon2id-хеширования паролей.
 *
 * Критичный путь безопасности: пароль никогда не хранится в открытом
 * виде, битый хеш не роняет вход (verify → false), одинаковые пароли
 * дают разные хеши (уникальная соль).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  assertPassword,
  ARGON2ID_PHASH_PREFIX,
  ARGON2_MEMORY_COST_KIB,
  ARGON2_TIME_COST,
  ARGON2_PARALLELISM,
} from '../src/index.js';

const PASSWORD = 'correct-horse-battery';

test('хеш — argon2id с параметрами OWASP (m=19456, t=2, p=1)', async () => {
  const passwordHash = await hashPassword(PASSWORD);

  assert.match(passwordHash, /^\$argon2id\$/, 'алгоритм — argon2id');
  assert.match(
    passwordHash,
    new RegExp(`\\$m=${ARGON2_MEMORY_COST_KIB},t=${ARGON2_TIME_COST},p=${ARGON2_PARALLELISM}\\$`),
    'в хеше зашиты параметры OWASP',
  );
  assert.ok(passwordHash.startsWith(ARGON2ID_PHASH_PREFIX));
});

test('верификация: верный пароль проходит, неверный — нет', async () => {
  const passwordHash = await hashPassword(PASSWORD);

  assert.equal(await verifyPassword(passwordHash, PASSWORD), true);
  assert.equal(await verifyPassword(passwordHash, 'wrong-password'), false);
  assert.equal(await verifyPassword(passwordHash, ''), false);
  assert.equal(await verifyPassword(passwordHash, `${PASSWORD} `), false);
});

test('одинаковые пароли дают разные хеши (уникальная соль)', async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);

  assert.notEqual(first, second, 'соли разные');
  assert.equal(await verifyPassword(first, PASSWORD), true);
  assert.equal(await verifyPassword(second, PASSWORD), true);
});

test('битый или чужой хеш → false, а не исключение', async () => {
  const broken = [
    '',
    'не-хеш',
    '$argon2id$v=19$m=19456,t=2,p=1$битый$хеш',
    '$argon2id$v=19$m=19456,t=2,p=1$c3VwZXItc2FsdA$not-base64-at-all',
    '$2b$12$' + 'x'.repeat(53), // bcrypt — не наш алгоритм
    '$argon2i$v=19$m=19456,t=2,p=1$c3VwZXItc2FsdA$c3VwZXItaGFzaA',
  ];

  for (const passwordHash of broken) {
    assert.equal(
      await verifyPassword(passwordHash, PASSWORD),
      false,
      `хеш "${passwordHash.slice(0, 24)}…" должен давать false`,
    );
  }
});

test('verifyPassword не бросает на нестроковых входах', async () => {
  const passwordHash = await hashPassword(PASSWORD);

  assert.equal(await verifyPassword(passwordHash, undefined as unknown as string), false);
  assert.equal(await verifyPassword(undefined as unknown as string, PASSWORD), false);
  assert.equal(await verifyPassword(null as unknown as string, null as unknown as string), false);
});

test('assertPassword: минимум 8 символов, максимум 128', () => {
  assert.doesNotThrow(() => assertPassword('12345678'));
  assert.throws(() => assertPassword('1234567'), RangeError);
  assert.throws(() => assertPassword('x'.repeat(129)), RangeError);
  assert.throws(() => assertPassword(undefined as unknown as string), TypeError);
});

test('хеширование слишком короткого пароля отклоняется', async () => {
  await assert.rejects(() => hashPassword('1234567'), RangeError);
});

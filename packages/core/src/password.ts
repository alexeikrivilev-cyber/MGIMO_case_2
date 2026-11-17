/**
 * Хеширование паролей — argon2id, параметры OWASP.
 *
 * Параметры по умолчанию соответствуют рекомендации OWASP Password
 * Storage Cheat Sheet для argon2id: memoryCost 19 МиБ (19456 КиБ),
 * timeCost 2, parallelism 1. Это «умеренный» профиль: ~50-100 мс на
 * хеш на обычном CPU — достаточно медленно для перебора онлайнного
 * и достаточно быстро для входа пользователя.
 *
 * В базе хранится ТОЛЬКО готовый PHC-строкой хеш (с солью и параметрами
 * внутри); сам пароль не сохраняется и не логируется никогда.
 */
import { hash, verify } from 'argon2';

/** Стоимость по памяти в КиБ (19 МиБ) — рекомендация OWASP. */
export const ARGON2_MEMORY_COST_KIB = 19456;

/** Число проходов (время) — рекомендация OWASP. */
export const ARGON2_TIME_COST = 2;

/** Параллелизм — рекомендация OWASP. */
export const ARGON2_PARALLELISM = 1;

/** Длина соли в байтах: argon2 генерирует такую соль автоматически. */
export const ARGON2_SALT_BYTES = 16;

/** Длина выходного хеша в байтах. */
export const ARGON2_HASH_LENGTH_BYTES = 32;

/** Тип алгоритма, с которым работает пакет. */
export const PASSWORD_HASH_ALGORITHM = 'argon2id' as const;

/** Префикс PHC-строки argon2id — используется проверками и сидером. */
export const ARGON2ID_PHASH_PREFIX = '$argon2id$';

/**
 * Хеширует пароль. Каждый вызов генерирует новую соль, поэтому одинаковые
 * пароли дают разные хеши (проверено в тестах).
 */
export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);
  return hash(password, {
    type: 2, // argon2id (ARGON2ID = 2 в нативной библиотеке)
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LENGTH_BYTES,
    // Соль argon2 генерирует сам (16 байт) — параметр не передаётся.
  });
}

/**
 * Проверяет пароль против хеша.
 *
 * Контракт безопасности: функция НИКОГДА не бросает исключение — на любом
 * повреждённом, чужом или некорректном хеше возвращает false. Исключение
 * здесь превратило бы «битую запись в БД» в отказ сервиса (DoS) и в
 * различие в поведении между «неверный пароль» и «сломанный хеш».
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (typeof passwordHash !== 'string' || passwordHash === '') {
    return false;
  }
  if (typeof password !== 'string' || password === '') {
    return false;
  }
  if (!passwordHash.startsWith(ARGON2ID_PHASH_PREFIX)) {
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    // Битый или некорректный хеш: argon2 не смог разобрать PHC-строку.
    return false;
  }
}

/** Проверяет пригодность пароля до хеширования (граница API — P1.4). */
export function assertPassword(password: string): void {
  if (typeof password !== 'string') {
    throw new TypeError('Пароль должен быть строкой.');
  }
  if (password.length < 8) {
    throw new RangeError('Пароль должен содержать не менее 8 символов.');
  }
  if (password.length > 128) {
    // argon2 принимает длинные пароли, но 128+ — почти всегда атака/сбой.
    throw new RangeError('Пароль должен содержать не более 128 символов.');
  }
}

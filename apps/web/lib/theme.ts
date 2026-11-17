/**
 * Тема интерфейса: тёмная — по умолчанию (решение Council, PRD §8).
 *
 * Имя cookie и правило выбора — общие для корневого лэйаута (первая
 * отрисовка на сервере) и переключателя (правка класса на <html>).
 * Cookie хранит ПРЕДПОЧТЕНИЕ интерфейса, а не секрет авторизации:
 * токен сессии живёт только в httpOnly-cookie udgu_session.
 */

/** Имя cookie предпочтения темы. */
export const THEME_COOKIE_NAME = 'udgu_theme';

export type Theme = 'light' | 'dark';

/** Тема по значению cookie: всё, кроме «light», — тёмная (значение по умолчанию). */
export function themeFromCookie(value: string | undefined): Theme {
  return value === 'light' ? 'light' : 'dark';
}

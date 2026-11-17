/**
 * Демо-доступы прототипа «Цифровой деканат будущего» (BRIEF v4).
 *
 * Зачем единый модуль: демо-пароль раньше был захардкожен в трёх местах
 * (сидер packages/db, тесты apps/web, подсказка на странице входа) —
 * любое расхождение ломало вход жюри. Значение живёт один раз здесь,
 * потребители импортируют его.
 *
 * Это НЕ секрет: пароль намеренно публикуется в README и в подсказке
 * на форме входа — жюри должно входить без подготовки. Google Password
 * Manager помечает массово разошёдшиеся пароли (прежний `password123`)
 * как «утёкшие», поэтому демо-пароль — случайный: 16 символов из
 * четырёх классов (верхний и нижний регистр, цифры, спецсимволы),
 * сгенерирован через crypto.randomInt.
 *
 * packages/ui намеренно без node-зависимостей (чистый TS): модуль
 * работает и в браузере (страница входа), и в сидере, и в тестах.
 */

/** Демо-пароль всех тестовых аккаунтов прототипа (публичный by design). */
export const DEMO_PASSWORD = 'aJMSwSxV_859b7A5';

/** Роль учётной записи в системе (как users.role в БД). */
export type DemoRole = 'STUDENT' | 'STAFF' | 'ADMIN';

/** Демо-аккаунт: логин, роль в системе и подпись для подсказки на входе. */
export interface DemoAccount {
  readonly login: string;
  readonly role: DemoRole;
  /** Короткая подпись кнопки подстановки (BRIEF v4: минимум текста). */
  readonly label: string;
}

/**
 * Аккаунты подсказки «Демо-доступ» на странице входа: по ним жюри
 * нажимает кнопку, и логин с паролем подставляются в форму.
 *
 * Сидер создаёт всех этих пользователей с этим же паролем (student1…
 * student4, teacher1…teacher16, staff1, admin1 — проверяется тестом
 * packages/db/test/seed.test.ts). Здесь — репрезентативная выборка по
 * ролям, а не все 22 аккаунта: подсказка должна помещаться на экране
 * телефона (минимализм текста, BRIEF v4).
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { login: 'student1', role: 'STUDENT', label: 'студент' },
  { login: 'student2', role: 'STUDENT', label: 'студент' },
  { login: 'student3', role: 'STUDENT', label: 'студент' },
  { login: 'student4', role: 'STUDENT', label: 'студент' },
  { login: 'teacher1', role: 'STAFF', label: 'преподаватель' },
  { login: 'teacher2', role: 'STAFF', label: 'преподаватель' },
  { login: 'teacher3', role: 'STAFF', label: 'преподаватель' },
  { login: 'staff1', role: 'STAFF', label: 'сотрудник деканата' },
  { login: 'admin1', role: 'ADMIN', label: 'администратор' },
];

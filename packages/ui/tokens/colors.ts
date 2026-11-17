/**
 * Цветовые токены @horizon/ui.
 *
 * Формат — DTCG-подобный (Design Tokens Community Group): каждый токен — объект
 * { $value, $type, $description? }. Три уровня:
 *
 *   1. primitive — базовая палитра (индиго, нейтральные, семантические шкалы);
 *   2. semantic  — смысловые токены (surface, text, border, brand, состояния),
 *      отдельный набор для светлой и тёмной темы;
 *   3. component — токены компонентов (кнопки, поля ввода, карточки, бейджи, навигация).
 *
 * Значения проверены на контраст WCAG 2.2 AA (см. scripts/check-contrast.mjs):
 * текст на surface — не меньше 4.5:1, границы интерактивных контролов — не меньше 3:1.
 *
 * Префикс CSS-переменных в tokens/theme.css — `--hz-`.
 */

export type TokenType =
  | "color"
  | "dimension"
  | "duration"
  | "cubicBezier"
  | "fontFamily"
  | "fontWeight"
  | "number"
  | "shadow";

export interface Token<T = string> {
  readonly $value: T;
  readonly $type: TokenType;
  readonly $description?: string;
}

export const token = <T>(
  $value: T,
  $type: TokenType,
  $description?: string,
): Token<T> =>
  $description === undefined
    ? { $value, $type }
    : { $value, $type, $description };

export const color = (hex: string, $description?: string): Token =>
  token(hex, "color", $description);

/** Значение токена — для удобного потребления из TS (например, в конфигах). */
export const $val = <T>(t: Token<T>): T => t.$value;

/* ------------------------------------------------------------------ */
/* 1. primitive — базовая палитра                                     */
/* ------------------------------------------------------------------ */

/** Индиго — основной акцент бренда («digital horizon»). */
export const indigo = {
  50: color("#eef2ff", "Индиго 50 — самый светлый тинт"),
  100: color("#e0e7ff", "Индиго 100 — подсветка, brand-subtle (светлая тема)"),
  200: color("#c7d2fe"),
  300: color("#a5b4fc"),
  400: color("#818cf8", "Индиго 400 — brand на тёмном фоне"),
  500: color("#6366f1"),
  550: color("#5a55e0", "Индиго 550 — hover для тёмной темы"),
  600: color("#4f46e5", "Индиго 600 — brand, основная заливка кнопок"),
  700: color("#4338ca", "Индиго 700 — hover, активные состояния"),
  800: color("#3730a3"),
  900: color("#312e81"),
  950: color("#1e1b4b"),
} as const;

/** Нейтральные (slate) — текст, поверхности, границы. */
export const neutral = {
  50: color("#f8fafc", "Нейтральный 50 — surface (светлая тема)"),
  100: color("#f1f5f9", "Нейтральный 100 — surface-sunken, hover-фоны"),
  200: color("#e2e8f0", "Нейтральный 200 — border (светлая тема)"),
  300: color("#cbd5e1"),
  400: color("#94a3b8"),
  450: color("#8391a8", "Нейтральный 450 — граница полей ввода (3:1 на белом)"),
  500: color("#64748b", "Нейтральный 500 — text-tertiary, placeholder"),
  600: color("#475569", "Нейтральный 600 — text-secondary"),
  700: color("#334155"),
  800: color("#1e293b"),
  900: color("#0f172a", "Нейтральный 900 — text-primary (светлая тема)"),
  950: color("#020617"),
} as const;

/** Глубокий индиго-насыщенный navy — поверхности тёмной темы. */
export const navy = {
  950: color("#070b16", "Navy 950 — surface-sunken (тёмная тема)"),
  900: color("#0b1120", "Navy 900 — surface (тёмная тема)"),
  850: color("#0e1526", "Navy 850 — фон полей ввода и навигации (тёмная)"),
  800: color("#151d31", "Navy 800 — surface-raised (тёмная тема)"),
  750: color("#1b2440", "Navy 750 — overlay, hover-фоны (тёмная)"),
  700: color("#1e2440", "Navy 700 — brand-subtle, selected (тёмная)"),
  600: color("#232f52", "Navy 600 — active-фон (тёмная)"),
  500: color("#26304d", "Navy 500 — border (тёмная тема)"),
  400: color("#3d4c6b", "Navy 400 — border-strong (тёмная тема)"),
  350: color("#5a6b91", "Navy 350 — граница полей ввода (3:1 на raised)"),
  300: color("#6b7da3", "Navy 300 — hover-граница полей ввода (тёмная)"),
} as const;

/** Success — зелёная шкала. */
export const success = {
  50: color("#f0fdf4", "Зелёный 50 — фон успешных бейджей (светлая)"),
  100: color("#dcfce7"),
  400: color("#4ade80", "Зелёный 400 — success-текст (тёмная тема)"),
  500: color("#22c55e"),
  600: color("#16a34a"),
  700: color("#15803d", "Зелёный 700 — success-текст (светлая тема)"),
  950: color("#123324", "Зелёный 950 — фон успешных бейджей (тёмная)"),
} as const;

/** Warning — янтарная шкала. */
export const warning = {
  50: color("#fffbeb", "Янтарный 50 — фон предупреждающих бейджей (светлая)"),
  100: color("#fef3c7"),
  400: color("#fbbf24", "Янтарный 400 — warning-текст (тёмная тема)"),
  500: color("#f59e0b"),
  600: color("#d97706"),
  700: color("#b45309", "Янтарный 700 — warning-текст (светлая тема)"),
  950: color("#3a2a0a", "Янтарный 950 — фон предупреждающих бейджей (тёмная)"),
} as const;

/** Danger — красная шкала. */
export const danger = {
  50: color("#fef2f2", "Красный 50 — фон ошибок (светлая)"),
  100: color("#fee2e2"),
  400: color("#f87171", "Красный 400 — danger-текст (тёмная тема)"),
  500: color("#ef4444"),
  600: color("#dc2626", "Красный 600 — ошибки полей ввода, иконки"),
  700: color("#b91c1c", "Красный 700 — danger-текст (светлая тема)"),
  950: color("#3f1d1d", "Красный 950 — фон ошибок (тёмная)"),
} as const;

/** Info — небесная шкала. */
export const info = {
  50: color("#f0f9ff", "Небесный 50 — фон информационных бейджей (светлая)"),
  100: color("#e0f2fe"),
  400: color("#38bdf8", "Небесный 400 — info-текст (тёмная тема)"),
  500: color("#0ea5e9"),
  600: color("#0284c7"),
  700: color("#0369a1", "Небесный 700 — info-текст (светлая тема)"),
  950: color("#0c2f44", "Небесный 950 — фон информационных бейджей (тёмная)"),
} as const;

export const white = color("#ffffff", "Базовый белый");
export const black = color("#000000", "Базовый чёрный");

export const primitive = {
  indigo,
  neutral,
  navy,
  success,
  warning,
  danger,
  info,
  white,
  black,
} as const;

/* ------------------------------------------------------------------ */
/* 2. semantic — смысловые токены                                     */
/* ------------------------------------------------------------------ */

export const semanticLight = {
  /* поверхности */
  surface: color($val(neutral[50]), "Фон страницы (светлая тема)"),
  surfaceRaised: color($val(white), "Карточки, модальные окна, панели"),
  surfaceSunken: color($val(neutral[100]), "Утопленные области, скелетоны"),
  surfaceOverlay: color($val(white), "Оверлеи поверх контента"),

  /* текст */
  textPrimary: color($val(neutral[900]), "Основной текст"),
  textSecondary: color($val(neutral[600]), "Второстепенный текст, подписи"),
  textTertiary: color($val(neutral[500]), "Третичный текст, caption, placeholder"),
  textInverse: color($val(neutral[50]), "Текст на тёмных заливках"),
  textOnBrand: color($val(white), "Текст на brand-заливке (кнопки)"),

  /* границы */
  border: color($val(neutral[200]), "Разделители, границы карточек"),
  borderStrong: color($val(neutral[300]), "Усиленные границы"),

  /* бренд */
  brand: color($val(indigo[600]), "Основной акцент, ссылки, активные состояния"),
  brandHover: color($val(indigo[700]), "Hover по брендовым элементам"),
  brandSubtle: color($val(indigo[100]), "Мягкая брендовая подсветка"),
  focusRing: color($val(indigo[600]), "Цвет кольца фокуса (3:1 к соседним цветам)"),

  /* ссылки */
  link: color($val(indigo[600]), "Цвет ссылок"),
  linkHover: color($val(indigo[700]), "Hover ссылок"),

  /* статусы */
  success: color($val(success[700]), "Успех: текст, иконки"),
  successSubtle: color($val(success[50]), "Успех: фон бейджей"),
  warning: color($val(warning[700]), "Предупреждение: текст, иконки"),
  warningSubtle: color($val(warning[50]), "Предупреждение: фон бейджей"),
  danger: color($val(danger[700]), "Ошибка: текст, иконки"),
  dangerSubtle: color($val(danger[50]), "Ошибка: фон бейджей"),
  info: color($val(info[700]), "Информация: текст, иконки"),
  infoSubtle: color($val(info[50]), "Информация: фон бейджей"),

  /* состояния интерфейса */
  stateHoverBg: color($val(neutral[100]), "Фон hover в списках и меню"),
  stateActiveBg: color($val(neutral[200]), "Фон нажатия"),
  stateSelectedBg: color($val(indigo[100]), "Фон выбранного элемента"),
  stateSelectedText: color($val(indigo[700]), "Текст выбранного элемента"),
  stateDisabledBg: color($val(neutral[100]), "Фон заблокированных элементов"),
  stateDisabledText: color($val(neutral[400]), "Текст заблокированных элементов"),
} as const;

export const semanticDark = {
  /* поверхности */
  surface: color($val(navy[900]), "Фон страницы (тёмная тема)"),
  surfaceRaised: color($val(navy[800]), "Карточки, модальные окна, панели"),
  surfaceSunken: color($val(navy[950]), "Утопленные области, скелетоны"),
  surfaceOverlay: color($val(navy[750]), "Оверлеи поверх контента"),

  /* текст */
  textPrimary: color($val(neutral[100]), "Основной текст"),
  textSecondary: color($val(neutral[400]), "Второстепенный текст, подписи"),
  textTertiary: color("#7d8ba6", "Третичный текст, caption, placeholder"),
  textInverse: color($val(neutral[900]), "Текст на светлых заливках"),
  textOnBrand: color($val(white), "Текст на brand-заливке (кнопки)"),

  /* границы */
  border: color($val(navy[500]), "Разделители, границы карточек"),
  borderStrong: color($val(navy[400]), "Усиленные границы"),

  /* бренд */
  brand: color($val(indigo[400]), "Основной акцент на тёмном фоне"),
  brandHover: color($val(indigo[300]), "Hover по брендовым элементам"),
  brandSubtle: color($val(navy[700]), "Мягкая брендовая подсветка"),
  focusRing: color($val(indigo[400]), "Цвет кольца фокуса (3:1 к соседним цветам)"),

  /* ссылки */
  link: color($val(indigo[300]), "Цвет ссылок"),
  linkHover: color($val(indigo[200]), "Hover ссылок"),

  /* статусы */
  success: color($val(success[400]), "Успех: текст, иконки"),
  successSubtle: color($val(success[950]), "Успех: фон бейджей"),
  warning: color($val(warning[400]), "Предупреждение: текст, иконки"),
  warningSubtle: color($val(warning[950]), "Предупреждение: фон бейджей"),
  danger: color($val(danger[400]), "Ошибка: текст, иконки"),
  dangerSubtle: color($val(danger[950]), "Ошибка: фон бейджей"),
  info: color($val(info[400]), "Информация: текст, иконки"),
  infoSubtle: color($val(info[950]), "Информация: фон бейджей"),

  /* состояния интерфейса */
  stateHoverBg: color($val(navy[750]), "Фон hover в списках и меню"),
  stateActiveBg: color($val(navy[600]), "Фон нажатия"),
  stateSelectedBg: color($val(navy[700]), "Фон выбранного элемента"),
  stateSelectedText: color($val(indigo[300]), "Текст выбранного элемента"),
  stateDisabledBg: color($val(navy[800]), "Фон заблокированных элементов"),
  stateDisabledText: color($val(navy[350]), "Текст заблокированных элементов"),
} as const;

export const semantic = {
  light: semanticLight,
  dark: semanticDark,
} as const;

export type SemanticTheme = keyof typeof semantic;

/* ------------------------------------------------------------------ */
/* 3. component — токены компонентов                                  */
/* ------------------------------------------------------------------ */

export const componentLight = {
  /* основная кнопка */
  buttonPrimaryBg: color($val(indigo[600]), "Заливка основной кнопки"),
  buttonPrimaryBgHover: color($val(indigo[700]), "Hover основной кнопки"),
  buttonPrimaryText: color($val(white), "Текст основной кнопки"),

  /* второстепенная кнопка */
  buttonSecondaryBg: color($val(white), "Заливка вторичной кнопки"),
  buttonSecondaryBgHover: color($val(neutral[100]), "Hover вторичной кнопки"),
  buttonSecondaryBorder: color($val(neutral[450]), "Граница вторичной кнопки (3:1 к фону)"),
  buttonSecondaryText: color($val(neutral[700]), "Текст вторичной кнопки"),

  /* кнопка-призрак */
  buttonGhostText: color($val(indigo[600]), "Текст кнопки-призрака"),
  buttonGhostBgHover: color($val(indigo[100]), "Hover кнопки-призрака"),

  /* опасное действие */
  buttonDangerBg: color($val(danger[600]), "Заливка деструктивной кнопки"),
  buttonDangerBgHover: color($val(danger[700]), "Hover деструктивной кнопки"),
  buttonDangerText: color($val(white), "Текст деструктивной кнопки"),

  /* поле ввода */
  inputBg: color($val(white), "Фон поля ввода"),
  inputBorder: color($val(neutral[450]), "Граница поля ввода (3:1 к фону)"),
  inputBorderHover: color($val(neutral[500]), "Граница поля ввода при hover"),
  inputBorderFocus: color($val(indigo[600]), "Граница поля ввода в фокусе"),
  inputBorderError: color($val(danger[600]), "Граница поля с ошибкой"),
  inputText: color($val(neutral[900]), "Текст в поле ввода"),
  inputPlaceholder: color($val(neutral[500]), "Placeholder поля ввода"),

  /* карточка */
  cardBg: color($val(white), "Фон карточки"),
  cardBorder: color($val(neutral[200]), "Граница карточки"),

  /* навигация */
  navBg: color($val(white), "Фон навигации"),
  navText: color($val(neutral[600]), "Текст неактивных пунктов"),
  navTextActive: color($val(indigo[600]), "Текст активного пункта"),
  navActiveBg: color($val(indigo[100]), "Фон активного пункта"),

  /* бейджи */
  badgeNeutralBg: color($val(neutral[100]), "Фон нейтрального бейджа"),
  badgeNeutralText: color($val(neutral[700]), "Текст нейтрального бейджа"),
  badgeSuccessBg: color($val(success[50]), "Фон бейджа успеха"),
  badgeSuccessText: color($val(success[700]), "Текст бейджа успеха"),
  badgeWarningBg: color($val(warning[50]), "Фон бейджа предупреждения"),
  badgeWarningText: color($val(warning[700]), "Текст бейджа предупреждения"),
  badgeDangerBg: color($val(danger[50]), "Фон бейджа ошибки"),
  badgeDangerText: color($val(danger[700]), "Текст бейджа ошибки"),
  badgeInfoBg: color($val(info[50]), "Фон информационного бейджа"),
  badgeInfoText: color($val(info[700]), "Текст информационного бейджа"),

  /* скелетон */
  skeletonBg: color($val(neutral[200]), "Фон скелетона загрузки"),
} as const;

export const componentDark = {
  /* основная кнопка */
  buttonPrimaryBg: color($val(indigo[600]), "Заливка основной кнопки"),
  buttonPrimaryBgHover: color($val(indigo[550]), "Hover основной кнопки"),
  buttonPrimaryText: color($val(white), "Текст основной кнопки"),

  /* второстепенная кнопка */
  buttonSecondaryBg: color($val(navy[750]), "Заливка вторичной кнопки"),
  buttonSecondaryBgHover: color($val(navy[600]), "Hover вторичной кнопки"),
  buttonSecondaryBorder: color($val(navy[300]), "Граница вторичной кнопки (3:1 к фону)"),
  buttonSecondaryText: color($val(neutral[200]), "Текст вторичной кнопки"),

  /* кнопка-призрак */
  buttonGhostText: color($val(indigo[300]), "Текст кнопки-призрака"),
  buttonGhostBgHover: color($val(navy[700]), "Hover кнопки-призрака"),

  /* опасное действие */
  buttonDangerBg: color($val(danger[600]), "Заливка деструктивной кнопки"),
  buttonDangerBgHover: color($val(danger[700]), "Hover деструктивной кнопки"),
  buttonDangerText: color($val(white), "Текст деструктивной кнопки"),

  /* поле ввода */
  inputBg: color($val(navy[850]), "Фон поля ввода"),
  inputBorder: color($val(navy[350]), "Граница поля ввода (3:1 к фону)"),
  inputBorderHover: color($val(navy[300]), "Граница поля ввода при hover"),
  inputBorderFocus: color($val(indigo[400]), "Граница поля ввода в фокусе"),
  inputBorderError: color($val(danger[400]), "Граница поля с ошибкой"),
  inputText: color($val(neutral[100]), "Текст в поле ввода"),
  inputPlaceholder: color("#7d8ba6", "Placeholder поля ввода"),

  /* карточка */
  cardBg: color($val(navy[800]), "Фон карточки"),
  cardBorder: color($val(navy[500]), "Граница карточки"),

  /* навигация */
  navBg: color($val(navy[850]), "Фон навигации"),
  navText: color($val(neutral[400]), "Текст неактивных пунктов"),
  navTextActive: color($val(indigo[300]), "Текст активного пункта"),
  navActiveBg: color($val(navy[700]), "Фон активного пункта"),

  /* бейджи */
  badgeNeutralBg: color($val(navy[750]), "Фон нейтрального бейджа"),
  badgeNeutralText: color($val(neutral[200]), "Текст нейтрального бейджа"),
  badgeSuccessBg: color($val(success[950]), "Фон бейджа успеха"),
  badgeSuccessText: color($val(success[400]), "Текст бейджа успеха"),
  badgeWarningBg: color($val(warning[950]), "Фон бейджа предупреждения"),
  badgeWarningText: color($val(warning[400]), "Текст бейджа предупреждения"),
  badgeDangerBg: color($val(danger[950]), "Фон бейджа ошибки"),
  badgeDangerText: color($val(danger[400]), "Текст бейджа ошибки"),
  badgeInfoBg: color($val(info[950]), "Фон информационного бейджа"),
  badgeInfoText: color($val(info[400]), "Текст информационного бейджа"),

  /* скелетон */
  skeletonBg: color($val(navy[750]), "Фон скелетона загрузки"),
} as const;

export const component = {
  light: componentLight,
  dark: componentDark,
} as const;

# @horizon/ui — дизайн-токены «Цифрового деканата будущего»

Единый источник истины по визуальному языку прототипа личного кабинета студента
Университета «Горизонт»: цвет, типографика, геометрия, темы (светлая/тёмная).

Пакет не содержит сборки — только CSS custom properties и TS-токены.
Подключается в любое приложение монорепо (`apps/web` и т.д.).

## Подключение

```ts
// apps/web/src/app/layout.tsx (или точка входа приложения)
import "@horizon/ui/theme.css";
```

После импорта переменные `--hz-*` доступны глобально, а `body` уже получает
фон, цвет текста и системный шрифт темы. Дополнительная настройка не нужна.

## Темы

- По умолчанию тема следует системной (`prefers-color-scheme`).
- Принудительный выбор — атрибут на `<html>`:

```html
<html data-theme="light"> <!-- или data-theme="dark" -->
```

- `color-scheme` переключается автоматически (скроллбары, нативные контролы).
- При `prefers-reduced-motion: reduce` анимации отключаются.

## Использование CSS-переменных

```css
.card {
  background-color: var(--hz-card-bg);
  border: 1px solid var(--hz-card-border);
  border-radius: var(--hz-radius-lg);
  box-shadow: var(--hz-shadow-1);
  padding: var(--hz-space-4);
}

.button-primary {
  background-color: var(--hz-button-primary-bg);
  color: var(--hz-button-primary-text);
  border-radius: var(--hz-radius-md);
  padding: var(--hz-space-3) var(--hz-space-4);
  font-size: var(--hz-text-button-size);
  font-weight: var(--hz-text-button-weight);
  transition: background-color var(--hz-duration-fast) var(--hz-ease-standard);
}

.button-primary:hover {
  background-color: var(--hz-button-primary-bg-hover);
}
```

### Основные группы переменных

| Префикс | Содержимое |
|---|---|
| `--hz-surface*`, `--hz-text-*`, `--hz-border*` | semantic-токены поверхностей, текста, границ |
| `--hz-brand*`, `--hz-link*`, `--hz-focus-ring` | бренд, ссылки, кольцо фокуса |
| `--hz-success/warning/danger/info(-subtle)` | статусы и фоны бейджей |
| `--hz-state-*` | hover / active / selected / disabled |
| `--hz-button-*`, `--hz-input-*`, `--hz-card-*`, `--hz-nav-*`, `--hz-badge-*` | токены компонентов |
| `--hz-text-<style>-size/weight/leading/tracking` | шкала типов: `display, h1, h2, h3, body, body-sm, caption, button` |
| `--hz-font-sans`, `--hz-font-mono` | системные шрифтовые стеки |
| `--hz-space-{0..24}` | отступы, 4-based |
| `--hz-radius-{sm,md,lg,xl,full}` | радиусы |
| `--hz-shadow-{1,2,3}` | elevation |
| `--hz-duration-*`, `--hz-ease-*` | длительности и кривые анимаций |

Все цветовые токены переключаются темой автоматически — не хардкодьте hex в компонентах.

## Tailwind CSS v4

Токены подключаются в `@theme` приложения:

```css
/* apps/web/src/app/globals.css */
@import "tailwindcss";
@import "@horizon/ui/theme.css";

@theme inline {
  --color-surface: var(--hz-surface);
  --color-surface-raised: var(--hz-surface-raised);
  --color-text-primary: var(--hz-text-primary);
  --color-text-secondary: var(--hz-text-secondary);
  --color-border: var(--hz-border);
  --color-brand: var(--hz-brand);
  --color-brand-hover: var(--hz-brand-hover);
  --color-success: var(--hz-success);
  --color-warning: var(--hz-warning);
  --color-danger: var(--hz-danger);
  --color-info: var(--hz-info);
  --radius-card: var(--hz-radius-lg);
  --shadow-card: var(--hz-shadow-1);
}
```

## TS-токены

Для конфигов, тестов и генерации:

```ts
import { semantic, component, spacing, textStyles } from "@horizon/ui";
// или точечно: import { indigo } from "@horizon/ui/tokens/colors";

semantic.dark.surface.$value; // "#0b1120"
component.light.buttonPrimaryBg.$value; // "#4f46e5"
spacing[4].$value; // "1rem"
```

Формат — DTCG-подобный: `{ $value, $type, $description? }`, три уровня
(primitive → semantic → component). Значения в `tokens/theme.css` являются
рантайм-источником истины и соответствуют TS-файлам.

## Контрастность (WCAG 2.2 AA)

Все пары «текст → фон» проверены и проходят с запасом 4.5:1; границы
интерактивных контролов (поля ввода, кольцо фокуса) — 3:1 (WCAG 1.4.11).
Минимумы по теме: `text-tertiary on surface` — 4.55:1 (светлая),
`text-tertiary on surface-raised` — 4.88:1 (тёмная).

Перепроверить:

```bash
npm run check -w @horizon/ui        # контраст + паритет CSS ↔ TS
npm run check:contrast -w @horizon/ui  # только контраст
```

## Структура

```
packages/ui/
  tokens/
    colors.ts       # 3-уровневая цветовая система (DTCG-подобно)
    typography.ts   # шкала типов (мобильная база 16px, модульная ~1.25)
    spacing.ts      # отступы, радиусы, тени, анимации
    theme.css       # CSS custom properties: светлая + тёмная темы
  src/index.ts      # реэкспорт токенов
  scripts/
    check-contrast.mjs  # проверка контраста по WCAG 2.2 AA
    check-parity.mjs    # проверка паритета theme.css ↔ colors.ts
```

Визуальная направленность: глубокий индиго-акцент, много воздуха, округлые
формы, мягкие тени. Шрифты — только системные стеки (без внешних загрузок).

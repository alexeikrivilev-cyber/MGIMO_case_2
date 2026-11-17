/**
 * Дизайн-токены Университета «Горизонт» — зеркало packages/ui/tokens.css
 * для использования в TypeScript (расчёты, пропсы компонентов).
 * Значения обязаны совпадать с CSS-переменными; при изменении —
 * меняй оба файла (проверяется ревью, позже — тестом паритета).
 */
export const tokens = {
  color: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    surface2: '#eef1f5',
    border: '#d9dee6',
    text: '#101828',
    textMuted: '#5c6577',
    primary: '#4f46e5',
    primaryHover: '#4338ca',
    primarySoft: '#eef2ff',
    onPrimary: '#ffffff',
    success: '#15803d',
    successSoft: '#ecfdf3',
    warning: '#b45309',
    warningSoft: '#fffaeb',
    danger: '#b42318',
    dangerSoft: '#fef3f2',
  },
  colorDark: {
    bg: '#0b0e14',
    surface: '#131824',
    surface2: '#1b2233',
    border: '#2a3348',
    text: '#e8ebf2',
    textMuted: '#9aa4b8',
    primary: '#818cf8',
    primaryHover: '#a5b4fc',
    primarySoft: '#1e2140',
    onPrimary: '#0b0e14',
    success: '#4ade80',
    successSoft: '#10281c',
    warning: '#fbbf24',
    warningSoft: '#2b2110',
    danger: '#f87171',
    dangerSoft: '#33161a',
  },
  space: {
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    12: '3rem',
    16: '4rem',
  },
  radius: {
    sm: '0.375rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    full: '9999px',
  },
  shadow: {
    sm: '0 1px 2px rgb(16 24 40 / 0.06)',
    md: '0 4px 12px rgb(16 24 40 / 0.08)',
    lg: '0 12px 32px rgb(16 24 40 / 0.12)',
  },
  font: {
    sans: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
  text: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
  },
  leading: {
    tight: '1.25',
    normal: '1.5',
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  breakpoint: {
    sm: '40rem',
    md: '48rem',
    lg: '64rem',
    xl: '80rem',
  },
  transition: {
    fast: '150ms ease',
    base: '220ms ease',
  },
  z: {
    dropdown: 100,
    modal: 200,
    toast: 300,
  },
} as const;

export type Tokens = typeof tokens;

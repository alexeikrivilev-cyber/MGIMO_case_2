/**
 * Иконки интерфейса кабинета: простейшие штриховые SVG (stroke, currentColor),
 * нарисованные для прототипа — без внешних библиотек и растровой графики
 * (требование кейса про лицензии и скорость). Все иконки декоративные:
 * смысл несут текстовые подписи рядом, поэтому aria-hidden=true.
 */

type IconProps = { className?: string };

const BASE = 'h-5 w-5 shrink-0';

export function IconToday({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

export function IconCalendar({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconGrades({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5h16" />
      <path d="M6.5 19.5v-6M11.5 19.5V8M16.5 19.5v-9.5" />
    </svg>
  );
}

export function IconRequests({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4.5h9l5 5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19.5V6A1.5 1.5 0 0 1 5 4.5Z" />
      <path d="M14 4.5v5h5M8 13h8M8 16.5h5" />
    </svg>
  );
}

export function IconBell({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.3 5.8 2.3 6.5H3.7C4.7 15.3 6 13.7 6 9.5Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function IconProfile({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </svg>
  );
}

export function IconTheme({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? BASE} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export function IconChevronLeft({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-5 w-5 shrink-0'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function IconChevronRight({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-5 w-5 shrink-0'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  );
}

export function IconArrowUp({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4 shrink-0'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V6M6 12l6-6 6 6" />
    </svg>
  );
}

export function IconArrowDown({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4 shrink-0'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v13M6 12l6 6 6-6" />
    </svg>
  );
}

export function IconMinus({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4 shrink-0'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

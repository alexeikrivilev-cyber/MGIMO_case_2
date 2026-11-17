'use client';

/**
 * Оболочка кабинета преподавателя (route group (teacher), /teacher/*).
 *
 * Состав — те же требования, что у остальных экранов (ACCEPTANCE, BRIEF):
 * - шапка: знак концепта + название раздела + выход + переключатель темы;
 *   под ней — постоянно видимый баннер концепта;
 * - нижняя навигация: три раздела преподавателя (Мои планы / Ассистент /
 *   Переписка), цели ≥ 44 px, активный раздел отмечен aria-current="page"
 *   (не только цветом). Переписка ведёт в общий раздел (messages), своё
 *   расписание преподаватель видит карточкой /teachers/<id>;
 * - мобильный first: flex-колонка с min-w-0, корневой overflow-x-hidden —
 *   на 360 px горизонтального скролла нет;
 * - тёмная тема по умолчанию: только токены @udgu/ui.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConceptBanner } from './ConceptBanner';
import { ConceptMark } from './ConceptMark';
import { LogoutButton } from './LogoutButton';
import { ThemeToggle } from './ThemeToggle';
import { FOCUS_RING } from '../lib/ui';
import { IconAssistant, IconChat, IconRequests } from './icons';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly fullLabel: string;
  readonly Icon: (props: { className?: string }) => React.JSX.Element;
}

/** Разделы нижней навигации преподавателя. */
const NAV_ITEMS: readonly NavItem[] = [
  { href: '/teacher/plans', label: 'Планы', fullLabel: 'Мои учебные планы', Icon: IconRequests },
  { href: '/teacher/assistant', label: 'Ассистент', fullLabel: 'Ассистент по учебному плану', Icon: IconAssistant },
  { href: '/messages', label: 'Переписка', fullLabel: 'Переписка со студентами', Icon: IconChat },
];

/** Название раздела для шапки по текущему пути. */
function sectionTitle(pathname: string | null): string {
  if (pathname === null) {
    return 'Кабинет преподавателя';
  }
  const item = NAV_ITEMS.find((candidate) => pathname === candidate.href || pathname.startsWith(`${candidate.href}/`));
  if (item !== undefined) {
    return item.fullLabel;
  }
  if (pathname.startsWith('/teachers')) {
    return 'Моё расписание';
  }
  return 'Кабинет преподавателя';
}

function isActive(pathname: string | null, href: string): boolean {
  if (pathname === null) {
    return false;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TeacherShell({ children }: { children: ReactNode }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>

      <div className="sticky top-0 z-20">
        <ConceptBanner />
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-1.5 px-3 py-1.5">
            <ConceptMark className="h-7 w-7 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-base font-semibold text-text" data-testid="section-title">
              {sectionTitle(pathname)}
            </p>
            <LogoutButton label="Выход" />
            <ThemeToggle />
          </div>
        </header>
      </div>

      <main id="main-content" className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 pb-28">
        {children}
      </main>

      <nav
        aria-label="Разделы кабинета преподавателя"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex w-full max-w-2xl">
          {NAV_ITEMS.map(({ href, label, fullLabel, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="min-w-0 flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={fullLabel}
                  className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-center text-[10px] leading-4 transition-colors ${FOCUS_RING} ${
                    active ? 'font-semibold text-primary' : 'font-medium text-text-muted hover:text-text'
                  }`}
                >
                  <span className="relative">
                    <Icon />
                  </span>
                  <span className="max-w-full whitespace-nowrap tracking-tight">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

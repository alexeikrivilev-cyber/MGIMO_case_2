'use client';

/**
 * Оболочка раздела «Переписка» (route group (messages), /messages).
 *
 * Почему отдельная оболочка, а не CabinetShell: раздел shared — им
 * пользуются и студент, и преподаватель, а нижняя навигация у них
 * разная (BRIEF v2 §4). Студент возвращается в свой кабинет и в
 * справочник преподавателей; преподаватель — к своему расписанию
 * (/teachers/<свой id>) и обратно в переписку.
 *
 * Требования те же, что у остальных экранов: баннер концепта, цели
 * ≥ 44 px, aria-current="page" у активного раздела, мобильный 360 px
 * без горизонтального скролла, тёмная тема по умолчанию (токены @udgu/ui).
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConceptBanner } from './ConceptBanner';
import { ConceptMark } from './ConceptMark';
import { LogoutButton } from './LogoutButton';
import { ThemeToggle } from './ThemeToggle';
import { FOCUS_RING } from '../lib/ui';
import { IconChat, IconToday, IconCalendar } from './icons';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly fullLabel: string;
  readonly Icon: (props: { className?: string }) => React.JSX.Element;
}

/** Пункты навигации студента: кабинет, справочник преподавателей, переписка. */
const STUDENT_NAV: readonly NavItem[] = [
  { href: '/', label: 'Кабинет', fullLabel: 'Личный кабинет', Icon: IconToday },
  { href: '/teachers', label: 'Преподаватели', fullLabel: 'Преподаватели', Icon: IconCalendar },
  { href: '/messages', label: 'Переписка', fullLabel: 'Переписка с преподавателями', Icon: IconChat },
];

/** Пункты навигации преподавателя: своё расписание и переписка. */
function teacherNav(teacherId: string): readonly NavItem[] {
  return [
    { href: `/teachers/${teacherId}`, label: 'Моё расписание', fullLabel: 'Моё расписание и часы приёма', Icon: IconCalendar },
    { href: '/messages', label: 'Переписка', fullLabel: 'Переписка со студентами', Icon: IconChat },
  ];
}

export function MessagesShell({
  children,
  mode,
  teacherId,
}: {
  children: ReactNode;
  /** Режим переписки по роли сессии. */
  mode: 'student' | 'teacher' | 'none';
  teacherId: string | null;
}): React.JSX.Element {
  const pathname = usePathname();
  const items = mode === 'teacher' && teacherId !== null ? teacherNav(teacherId) : STUDENT_NAV;

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
              Переписка
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
        aria-label="Разделы переписки"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex w-full max-w-2xl">
          {items.map(({ href, label, fullLabel, Icon }) => {
            const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
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

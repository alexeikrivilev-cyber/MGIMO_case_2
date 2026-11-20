'use client';

/**
 * Оболочка кабинета сотрудника деканата (route group (staff), /staff/*).
 *
 * Состав — те же требования, что у кабинета студента (ACCEPTANCE, BRIEF):
 * - шапка: знак концепта + название раздела + выход + переключатель темы;
 *   под ней — постоянно видимый баннер концепта;
 * - нижняя навигация: шесть разделов кабинета (сводка, заявки, верификация
 *   студбилетов, болезни, объявления, расписание), цели ≥ 44 px, активный
 *   раздел отмечен aria-current="page" (не только цветом);
 * - мобильный first: flex-колонка с min-w-0, корневой overflow-x-hidden —
 *   на 360 px горизонтального скролла нет;
 * - тёмная тема по умолчанию: только токены @udgu/ui.
 *
 * Подписи в навигации короткие (чтобы шесть пунктов поместились на
 * 360 px), полное название несёт aria-current/aria-label ссылки —
 * скринридер получает его целиком.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConceptBanner } from './ConceptBanner';
import { ConceptMark } from './ConceptMark';
import { LogoutButton } from './LogoutButton';
import { ThemeToggle } from './ThemeToggle';
import { FOCUS_RING, PRESS_FEEDBACK } from '../lib/ui';
import {
  IconCalendar,
  IconIdCard,
  IconMegaphone,
  IconMove,
  IconRequests,
  IconToday,
} from './icons';

/** Разделы нижней навигации: путь → короткая подпись, полное имя и иконка. */
const NAV_ITEMS: readonly {
  readonly href: string;
  readonly label: string;
  readonly fullLabel: string;
  readonly Icon: (props: { className?: string }) => React.JSX.Element;
}[] = [
  { href: '/staff', label: 'Сводка', fullLabel: 'Сводка кабинета', Icon: IconToday },
  { href: '/staff/requests', label: 'Заявки', fullLabel: 'Заявки и справки', Icon: IconRequests },
  { href: '/staff/verifications', label: 'Билеты', fullLabel: 'Верификация студбилетов', Icon: IconIdCard },
  { href: '/staff/sick-leaves', label: 'Болезни', fullLabel: 'Статусы «болею»', Icon: IconCalendar },
  { href: '/staff/announcements', label: 'Анонсы', fullLabel: 'Объявления', Icon: IconMegaphone },
  { href: '/staff/schedule', label: 'Пары', fullLabel: 'Расписание групп', Icon: IconMove },
];

/** Название раздела для шапки по текущему пути. */
function sectionTitle(pathname: string | null): string {
  if (pathname === null) {
    return 'Кабинет деканата';
  }
  // Точное совпадение важнее префикса: на /staff/requests раздел
  // «Заявки», а не «Сводка» (её путь — /staff).
  const exact = NAV_ITEMS.find((candidate) => pathname === candidate.href);
  if (exact !== undefined) {
    return exact.fullLabel;
  }
  const nested = NAV_ITEMS.find((candidate) => pathname.startsWith(`${candidate.href}/`));
  return nested?.fullLabel ?? 'Кабинет деканата';
}

function isActive(pathname: string | null, href: string): boolean {
  if (pathname === null) {
    return false;
  }
  // «Сводка» живёт на самом /staff: подпути /staff/requests её не
  // активируют, иначе в навигации горит два раздела сразу.
  return href === '/staff' ? pathname === '/staff' : pathname === href || pathname.startsWith(`${href}/`);
}

export function StaffShell({ children }: { children: ReactNode }): React.JSX.Element {
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
        aria-label="Разделы кабинета деканата"
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
                  className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-center text-[10px] leading-4 ${PRESS_FEEDBACK} ${FOCUS_RING} ${
                    active ? 'nav-indicator font-semibold text-primary' : 'font-medium text-text-muted hover:text-text'
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

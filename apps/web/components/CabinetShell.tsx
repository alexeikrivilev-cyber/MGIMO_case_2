'use client';

/**
 * Оболочка кабинета студента (route group (cabinet)).
 *
 * Состав (требования P1.4b):
 * - шапка: знак концепта + название раздела + выход + переключатель
 *   темы + кнопка профиля; под ней — постоянно видимый баннер концепта;
 * - нижняя навигация: 5 разделов (Сегодня / Расписание / Успеваемость /
 *   Заявки / Уведомления), цели ≥ 44 px, активный раздел отмечен
 *   aria-current="page" (не только цветом), на «Уведомлениях» — бейдж
 *   непрочитанных (UnreadBadge, данные из /api/notifications);
 * - мобильный first: всё в flex-колонке с min-w-0, корневой
 *   overflow-x-hidden — на 360 px горизонтального скролла нет;
 * - тема: тёмная по умолчанию (решение Council), переключение —
 *   ThemeToggle, выбор remembered в cookie.
 *
 * Название раздела — презентационное (p): единственный семантический h1
 * на экране остаётся у самой страницы (PageHeader).
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConceptBanner } from './ConceptBanner';
import { ConceptMark } from './ConceptMark';
import { LogoutButton } from './LogoutButton';
import { ThemeToggle } from './ThemeToggle';
import { UnreadBadge } from './UnreadBadge';
import { IconBell, IconCalendar, IconGrades, IconRequests, IconToday, IconProfile } from './icons';

/** Разделы нижней навигации: путь → подпись и иконка. */
const NAV_ITEMS: readonly {
  readonly href: string;
  readonly label: string;
  readonly Icon: (props: { className?: string }) => React.JSX.Element;
}[] = [
  { href: '/', label: 'Сегодня', Icon: IconToday },
  { href: '/schedule', label: 'Расписание', Icon: IconCalendar },
  { href: '/grades', label: 'Успеваемость', Icon: IconGrades },
  { href: '/requests', label: 'Заявки', Icon: IconRequests },
  { href: '/notifications', label: 'Уведомления', Icon: IconBell },
];

/** Название раздела для шапки по текущему пути. */
function sectionTitle(pathname: string | null): string {
  if (pathname === null) {
    return 'Кабинет';
  }
  if (pathname === '/' || pathname === '/dashboard') {
    return 'Сегодня';
  }
  if (pathname.startsWith('/teachers')) {
    return 'Преподаватели';
  }
  const item = NAV_ITEMS.find((candidate) => pathname === candidate.href || pathname.startsWith(`${candidate.href}/`));
  if (item !== undefined) {
    return item.label;
  }
  if (pathname === '/announcements') return 'Объявления';
  if (pathname === '/profile') return 'Профиль';
  if (pathname === '/verification') return 'Верификация';
  if (pathname === '/sick-leave') return 'Я болею';
  return 'Кабинет';
}

function isActive(pathname: string | null, href: string): boolean {
  if (pathname === null) {
    return false;
  }
  // «Сегодня» — корневой путь: активен только при точном совпадении.
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function CabinetShell({ children }: { children: ReactNode }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg">
      {/* Skip-link — первый фокус-элемент страницы (WCAG 2.4.1):
          с клавиатуры можно сразу перейти к содержимому, минуя шапку
          и пять пунктов навигации. */}
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>

      {/* Шапка + баннер концепта: закреплены сверху, всегда на виду */}
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
            <Link
              href="/profile"
              aria-label="Профиль"
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text ${FOCUS_RING}`}
            >
              <IconProfile />
            </Link>
          </div>
        </header>
      </div>

      {/* Контент: pb-28 — место под зафиксированную нижнюю навигацию */}
      <main id="main-content" className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 pb-28">
        {children}
      </main>

      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex w-full max-w-2xl">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            const badge = href === '/notifications' ? <UnreadBadge /> : null;
            return (
              <li key={href} className="min-w-0 flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={href === '/notifications' ? 'Уведомления' : undefined}
                  className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-center text-[10px] leading-4 transition-colors ${FOCUS_RING} ${
                    active ? 'font-semibold text-primary' : 'font-medium text-text-muted hover:text-text'
                  }`}
                >
                  <span className="relative">
                    <Icon />
                    {badge}
                  </span>
                  {/* whitespace-nowrap + tracking-tight: на 360 px пять пунктов
                      дают ~64 px на подпись, и «Успеваемость»/«Уведомления»
                      не должны переноситься пословно-внутри-слова. */}
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

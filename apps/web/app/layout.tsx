import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import './globals.css';
import '@udgu/ui/tokens.css';
import { THEME_COOKIE_NAME, themeFromCookie } from '../lib/theme';

export const metadata: Metadata = {
  title: 'Цифровой деканат — УдГУ',
  description:
    'Личный кабинет студента Удмуртского государственного университета: расписание, успеваемость, заявки и уведомления в одном месте.',
};

/**
 * Корневой лэйаут: html/body + тема.
 *
 * Тёмная тема — по умолчанию (решение Council, docs/PRD.md §8): класс
 * .dark на <html> включает угольную палитру из packages/ui/tokens.css.
 * Выбор пользователя (светлая тема) remembered в cookie udgu_theme —
 * предпочтение интерфейса, не секрет; читаем его здесь, чтобы первая
 * же отрисовка была в нужной теме без вспышки.
 */
export default async function RootLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <html lang="ru" className={theme} suppressHydrationWarning>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

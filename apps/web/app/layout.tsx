import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import './globals.css';
import '@udgu/ui/tokens.css';
import { THEME_COOKIE_NAME, themeFromCookie } from '../lib/theme';
import { ServiceWorkerRegister } from '../components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'Цифровой деканат — УдГУ',
  description:
    'Учебный концепт для конкурса: личный кабинет студента Удмуртского государственного университета — расписание, успеваемость, заявки и уведомления в одном месте. Не официальный сервис вуза.',
  // PWA: манифест лежит в public/ (рукотворный, без сторонних библиотек).
  manifest: '/manifest.webmanifest',
  // Знак концепта — свой (требование кейса: логотип вуза не используется).
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut: ['/icon.svg'],
    apple: [{ url: '/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Деканат УдГУ',
    statusBarStyle: 'black-translucent',
  },
  applicationName: 'Цифровой деканат — УдГУ',
};

/** theme-color — из ТЁМНЫХ токенов (тема по умолчанию, решение Council). */
export const viewport: Viewport = {
  themeColor: '#0b0e14',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
      <body className="min-h-screen">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

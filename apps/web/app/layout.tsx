import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import '@udgu/ui/tokens.css';

export const metadata: Metadata = {
  title: 'Цифровой деканат — УдГУ',
  description:
    'Личный кабинет студента Удмуртского государственного университета: расписание, успеваемость, заявки и уведомления в одном месте.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

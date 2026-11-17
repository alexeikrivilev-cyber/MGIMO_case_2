import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import '@horizon/ui/tokens.css';

export const metadata: Metadata = {
  title: 'Цифровой деканат — Университет «Горизонт»',
  description:
    'Личный кабинет студента: расписание, успеваемость, заявки и уведомления в одном месте.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

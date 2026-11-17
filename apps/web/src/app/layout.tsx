import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Цифровой деканат — Университет «Горизонт»",
    template: "%s — Горизонт",
  },
  description:
    "Личный кабинет студента Университета «Горизонт»: расписание, успеваемость, заявки и уведомления.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}

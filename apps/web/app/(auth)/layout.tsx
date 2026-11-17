import type { ReactNode } from 'react';
import { ConceptBanner } from '../../components/ConceptBanner';

/**
 * Лэйаут страниц входа и регистрации (route group (auth)): баннер
 * концепта сверху + центрированный контейнер формы. Нижней навигации
 * кабинета здесь нет — пользователь ещё не вошёл.
 *
 * Route group не влияет на URL: /login и /register остаются по своим
 * адресам, общий корневой лэйаут (html/body/тема) — общим.
 */
export default function AuthLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <ConceptBanner />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6">{children}</main>
    </div>
  );
}

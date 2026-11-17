import type { ReactNode } from 'react';
import { ConceptBanner } from '../../components/ConceptBanner';

/**
 * Лэйаут страниц входа и регистрации (route group (auth)): баннер
 * концепта сверху + центрированный контейнер формы. Нижней навигации
 * кабинета здесь нет — пользователь ещё не вошёл.
 *
 * Skip-link «Перейти к содержимому» — первый фокус-элемент экрана
 * (WCAG 2.4.1): до формы входа можно дойти с клавиатуры, не проходя
 * баннер и служебные ссылки.
 *
 * Route group не влияет на URL: /login и /register остаются по своим
 * адресам, общий корневой лэйаут (html/body/тема) — общим.
 */
export default function AuthLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>
      <ConceptBanner />
      <main id="main-content" className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6">
        {children}
      </main>
    </div>
  );
}

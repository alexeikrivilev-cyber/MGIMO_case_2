import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getSessionFromCookieHeader } from '../../lib/session';
import { StaffShell } from '../../components/StaffShell';

/**
 * Лэйаут кабинета сотрудника деканата (route group (staff), /staff/*).
 *
 * Гейт роли: раздел доступен только роли STAFF и ADMIN. Студент получает
 * 404 — не 403: он не должен даже узнавать, что раздел существует
 * (требование ACCEPTANCE; middleware делает это же раньше, проверка
 * здесь дополнительная — решения об авторизации не зависят от прошедшего
 * гейта). Аноним уходит на /login.
 *
 * Преподаватель (STAFF без faculty в users) гейт проходит: его кабинет —
 * переписка (/messages), а не деканат. Очереди сотрудника ему недоступны
 * (requireStaffScope → STAFF_ONLY), и каждая страница показывает честное
 * состояние «раздел недоступен» с путём в его раздел.
 */
export default async function StaffLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const session = await getSessionFromCookieHeader(cookieStore.toString());
  if (session === null) {
    redirect('/login');
  }
  if (session.user.role === 'STUDENT') {
    notFound();
  }

  return <StaffShell>{children}</StaffShell>;
}

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookieHeader } from '../../lib/session';
import { CabinetShell } from '../../components/CabinetShell';

/**
 * Лэйаут кабинета студента (route group (cabinet)).
 *
 * Гейт роли: кабинет студента доступен только роли STUDENT. Сессия
 * читается из httpOnly-cookie и валидируется боевым validateSession
 * (packages/core) — страница не рисует «пустой кабинет» для чужой роли.
 * Сотрудник деканата и админ уходят в /staff (их кабинет — P2),
 * аноним — на /login (middleware делает это же раньше, проверка здесь
 * дополнительная: решения об авторизации не зависят от прошедшего гейта).
 */
export default async function CabinetLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const session = await getSessionFromCookieHeader(cookieStore.toString());
  if (session === null) {
    redirect('/login');
  }
  if (session.user.role !== 'STUDENT') {
    redirect('/staff');
  }

  return <CabinetShell>{children}</CabinetShell>;
}

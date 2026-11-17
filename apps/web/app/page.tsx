import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookieHeader } from '../lib/session';

/**
 * Корень приложения: авторизованного — в его кабинет, остальных — на вход.
 *
 * Студент попадает в /dashboard, сотрудник деканата и админ — в /staff
 * (как и ответ маршрута входа: одна и та же роль → один и тот же кабинет).
 *
 * Сессия читается из httpOnly-cookie и валидируется боевым
 * validateSession (packages/core): страница не рисует «пустой кабинет»
 * для неавторизованного, а сразу отправляет на /login.
 */
export default async function Home(): Promise<never> {
  const cookieStore = await cookies();
  const session = await getSessionFromCookieHeader(cookieStore.toString());
  if (session === null) {
    redirect('/login');
  }
  redirect(session.user.role === 'STUDENT' ? '/dashboard' : '/staff');
}

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookieHeader } from '../../lib/session';
import { MessagesShell } from '../../components/MessagesShell';

/**
 * Лэйаут раздела «Переписка» (route group (messages), /messages).
 *
 * Раздел общий для двух ролей (BRIEF v2 §4): студент пишет преподавателю,
 * преподаватель отвечает. Роль решает, какую навигацию показать, —
 * поэтому лэйаут читает сессию и передаёт режим в оболочку. Аноним
 * уходит на /login (middleware закрывает путь раньше, проверка здесь
 * дополнительная).
 *
 * Переписка доступна только верифицированному студенту: сам гейт живёт
 * в packages/core (requireVerifiedStudent), здесь — только оболочка.
 */
export default async function MessagesLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const session = await getSessionFromCookieHeader(cookieStore.toString());
  if (session === null) {
    redirect('/login');
  }

  const user = session.user;
  const mode = user.role === 'STUDENT' ? 'student' : user.teacherId !== null ? 'teacher' : 'none';

  return (
    <MessagesShell mode={mode} teacherId={user.teacherId}>
      {children}
    </MessagesShell>
  );
}

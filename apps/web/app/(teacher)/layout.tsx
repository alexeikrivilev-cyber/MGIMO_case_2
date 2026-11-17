import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookieHeader, isTeacherUser } from '../../lib/session';
import { TeacherShell } from '../../components/TeacherShell';
import { ConceptBanner } from '../../components/ConceptBanner';
import { ConceptMark } from '../../components/ConceptMark';

/**
 * Лэйаут кабинета преподавателя (route group (teacher), /teacher/*).
 *
 * Гейт: раздел доступен пользователю с профилем преподавателя
 * (session.user.teacherId). Аноним уходит на /login (middleware делает
 * это же раньше, проверка здесь дополнительная — решения об авторизации
 * не зависят от прошедшего гейта).
 *
 * Студент, сотрудник деканата и админ БЕЗ профиля преподавателя получают
 * честную заглушку «раздел для преподавателей» со ссылкой в свой раздел —
 * НЕ 404 (раздел существует, он просто не theirs) и не пустой экран.
 * Преподаватель попадает в оболочку с нижней навигацией раздела.
 */
export default async function TeacherLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const session = await getSessionFromCookieHeader(cookieStore.toString());
  if (session === null) {
    redirect('/login');
  }

  const user = session.user;
  const isTeacher = isTeacherUser(user);
  if (!isTeacher) {
    const backHref = user.role === 'STUDENT' ? '/' : '/staff';
    const backLabel = user.role === 'STUDENT' ? 'В личный кабинет' : 'В кабинет деканата';
    return (
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg">
        {/* Баннер концепта обязателен на любом экране кабинета (ACCEPTANCE). */}
        <div className="sticky top-0 z-20">
          <ConceptBanner />
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex w-full max-w-2xl items-center gap-1.5 px-3 py-1.5">
              <ConceptMark className="h-7 w-7 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate text-base font-semibold text-text">Кабинет преподавателя</p>
            </div>
          </header>
        </div>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Раздел для преподавателей</h1>
          <p className="mt-2 text-sm text-text-muted">
            Учебные планы и ассистент по ним — в кабинете преподавателя.
          </p>
          <div className="mt-6">
            <a
              href={backHref}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {backLabel}
            </a>
          </div>
        </main>
      </div>
    );
  }

  return <TeacherShell>{children}</TeacherShell>;
}

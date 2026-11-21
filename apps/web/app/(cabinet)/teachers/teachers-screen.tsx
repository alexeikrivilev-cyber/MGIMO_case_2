/**
 * Экран «Преподаватели»: список преподавателей вуза (ФИО, кафедра,
 * должность) — общедоступная информация кабинета (BRIEF v2): студенту
 * нужно понимать, когда можно подойти к преподавателю.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { EmptyState } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { IconChevronRight, IconProfile } from '../../../components/icons';
import { PRESS_FEEDBACK } from '../../../lib/ui';
import { loadTeachersPageData, type LoadResult, type TeachersPageData } from '../../../lib/page-data';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function TeachersView({ result }: { result: LoadResult<TeachersPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader
            title="Преподаватели"
            subtitle="Пары, консультации, часы приёма"
          />

          {data.teachers.length === 0 ? (
            <EmptyState title="Преподавателей нет" icon={<IconProfile />} />
          ) : (
            <ul className="space-y-2">
              {data.teachers.map((teacher) => (
                <li key={teacher.id}>
                  <Link
                    href={`/teachers/${teacher.id}`}
                    className={`flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm ${PRESS_FEEDBACK} hover:bg-surface-2 ${FOCUS_RING}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text">{teacher.fullName}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {teacher.position} · {teacher.department}
                      </span>
                    </span>
                    <span className="shrink-0 text-text-muted">
                      <IconChevronRight />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function TeachersScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadTeachersPageData(cookieStore.toString());
  return <TeachersView result={result} />;
}

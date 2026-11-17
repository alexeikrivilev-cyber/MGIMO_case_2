/**
 * Экран «Мои планы» (кабинет преподавателя, BRIEF v2 §5).
 *
 * Сервер отдаёт список планов из packages/core (loadTeacherPlansPageData —
 * те же сервисы и та же сессия, что у страниц кабинета); загрузка и
 * удаление идут через /api/teacher/study-plans клиентским островом
 * (lib/api-client, CSRF-заголовок добавляется клиентом).
 *
 * Минимализм текста (BRIEF v4): форма — заголовок + файл + одна строка
 * пояснения; в списке — название, дата и размер; пустое состояние
 * объясняет, что будет, и называет действие результатом.
 */
import { cookies } from 'next/headers';
import { PageHeader } from '../../../../components/PageHeader';
import { PageResult } from '../../../../components/PageStates';
import {
  loadTeacherPlansPageData,
  type LoadResult,
  type TeacherPlansPageData,
} from '../../../../lib/page-data';
import { StudyPlanManager } from './StudyPlanManager';

export function TeacherPlansView({ result }: { result: LoadResult<TeacherPlansPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader title="Мои планы" subtitle="Учебные планы для ассистента" />
          <StudyPlanManager plans={data.plans} />
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → планы → вид. */
export async function StudyPlanScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadTeacherPlansPageData(cookieStore.toString());
  return <TeacherPlansView result={result} />;
}

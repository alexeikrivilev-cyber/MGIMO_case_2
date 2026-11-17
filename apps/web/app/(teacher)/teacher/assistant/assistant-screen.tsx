/**
 * Экран «Ассистент» преподавателя (BRIEF v2 §5, RAG по учебному плану).
 *
 * Сервер отдаёт список планов (для выбора, по какому отвечать) и
 * стартовые вопросы; сам ответ считает packages/core на
 * POST /api/teacher/assistant — клиентский остров спрашивает через
 * /api/* с CSRF-заголовком (lib/api-client), как все формы кабинета.
 *
 * Минимализм текста (BRIEF v4): поле ввода, чипы-подсказки, ответ в
 * живой области (aria-live) — без абзацев и инструкций.
 */
import { cookies } from 'next/headers';
import { PageHeader } from '../../../../components/PageHeader';
import { PageResult } from '../../../../components/PageStates';
import {
  loadTeacherAssistantPageData,
  type LoadResult,
  type TeacherAssistantPageData,
} from '../../../../lib/page-data';
import { TeacherAssistantPanel } from './TeacherAssistantPanel';

export function TeacherAssistantView({
  result,
}: {
  result: LoadResult<TeacherAssistantPageData>;
}): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader title="Ассистент" subtitle="Ответы по вашим учебным планам" />
          <TeacherAssistantPanel plans={data.plans} suggestions={data.suggestions} />
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → планы и подсказки → вид. */
export async function TeacherAssistantScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadTeacherAssistantPageData(cookieStore.toString());
  return <TeacherAssistantView result={result} />;
}

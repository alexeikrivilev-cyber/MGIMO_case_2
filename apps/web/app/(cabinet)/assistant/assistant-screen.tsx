/**
 * Экран «Ассистент» (BRIEF v2 §5).
 *
 * Сервер отдаёт стартовые подсказки (loadAssistantPageData — те же
 * сервисы и та же сессия, что у страниц кабинета); ответы на вопросы
 * считает packages/core на POST /api/assistant — клиентский остров
 * спрашивает через /api/* с CSRF-заголовком (lib/api-client), как все
 * остальные формы кабинета.
 *
 * Минимализм текста (BRIEF v4): поле ввода, чипы-подсказки, ответ в
 * живой области (aria-live) — без абзацев и инструкций.
 */
import { cookies } from 'next/headers';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { loadAssistantPageData, type AssistantPageData, type LoadResult } from '../../../lib/page-data';
import { AssistantPanel } from './AssistantPanel';

export function AssistantView({ result }: { result: LoadResult<AssistantPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader title="Ассистент" subtitle="Помощник по учёбе — по вашим данным" />
          <AssistantPanel suggestions={data.suggestions} />
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → стартовые подсказки → вид. */
export async function AssistantScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadAssistantPageData(cookieStore.toString());
  return <AssistantView result={result} />;
}

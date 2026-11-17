import { MessagesScreen } from './messages-screen';

/**
 * /messages — переписка кабинета: диалоги студента с преподавателями и
 * диалоги преподавателя со студентами (BRIEF v2 §4).
 *
 * Открытый диалог задаётся в адресе (?conversation=id) — ссылку на
 * конкретный диалог можно переслать, а страница работает без JS
 * (список и сообщения рендерит сервер; клиентские острова — только
 * отправка сообщения и отметка о прочтении).
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <MessagesScreen conversationId={params.conversation} />;
}

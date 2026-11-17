import { AssistantScreen } from './assistant-screen';

/**
 * /assistant — AI-ассистент студента (BRIEF v2 §5): помощь в учёбе и
 * закрытие долгов по его данным.
 *
 * Экран доступен всем вошедшим студентам: вопросы про оценки у
 * неверифицированного получают честную заглушку гейта (проверка на
 * сервере, packages/core), а расписание, заявки и уведомления
 * ассистент отдаёт всегда.
 */
export default async function AssistantPage(): Promise<React.JSX.Element> {
  return <AssistantScreen />;
}

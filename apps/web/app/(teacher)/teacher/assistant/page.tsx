import { TeacherAssistantScreen } from './assistant-screen';

/**
 * /teacher/assistant — AI-ассистент преподавателя (BRIEF v2 §5):
 * RAG по загруженному учебному плану. Вопрос → релевантные разделы
 * плана → цитаты-подсказки и сопоставление с долгами студентов.
 */
export default function TeacherAssistantPage(): React.JSX.Element {
  return <TeacherAssistantScreen />;
}

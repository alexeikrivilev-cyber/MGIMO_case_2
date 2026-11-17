import { StudyPlanScreen } from './plans-screen';

/**
 * /teacher/plans — учебные планы преподавателя (BRIEF v2 §5): загрузка
 * плана, список с датой и размером, удаление.
 *
 * Данные грузит сервер из packages/core (listMyStudyPlans) — теми же
 * сервисами, что и GET /api/teacher/study-plans; хранилища файлов
 * касается только packages/core (приватное хранилище).
 */
export default function TeacherPlansPage(): React.JSX.Element {
  return <StudyPlanScreen />;
}

/**
 * Клиентские константы ассистента студента.
 *
 * Отдельный лист-модуль БЕЗ импортов (ни Prisma, ни сервисов): браузерный
 * код кабинета импортирует его подпутем `@udgu/core/assistant` и не тянет
 * в бандл ядро с доступом к БД. Единственный источник истины для движка
 * (services/assistant.ts) и интерфейса (AssistantPanel).
 */

/**
 * Подсказка-чип гейта верификации. Это не вопрос, а действие: экран
 * ассистента ведёт по ней в раздел верификации студбилета.
 */
export const ASSISTANT_VERIFICATION_SUGGESTION = 'Верифицировать билет';

/**
 * Источник данных ответа: раздел кабинета, из которого ответ собран.
 * Ссылка несёт сразу два смысла — атрибуция («ответ не выдуман»,
 * волна 4 «оживления») и навигация в раздел.
 */
export interface AssistantSource {
  readonly label: string;
  readonly href: string;
}

/**
 * Источники ответа по интенту (чистая функция — проверяется без БД).
 *
 * Единый маппинг для движка и интерфейса: ответ собран из тех же
 * сервисов кабинета, что и страницы разделов, поэтому ссылка ведёт
 * именно туда, откуда данные. HELP, GREETING и UNKNOWN на данных
 * кабинета не построены — источников нет (врать нечем), как и у
 * заглушки гейта верификации (оценки закрыты).
 */
export function assistantSourcesFor(intent: string): readonly AssistantSource[] {
  switch (intent) {
    // Долги, план закрытия, средний балл и «что подтянуть»: успеваемость
    // плюс расписание — план закрытия использует свободные окна.
    case 'DEBTS':
    case 'STUDY_PLAN':
    case 'AVERAGE':
    case 'IMPROVE':
      return [
        { label: 'Успеваемость', href: '/grades' },
        { label: 'Расписание', href: '/schedule' },
      ];
    case 'SCHEDULE_TODAY':
    case 'SCHEDULE_NEXT':
      return [{ label: 'Расписание', href: '/schedule' }];
    case 'SICK_LEAVE':
      return [{ label: 'Я заболел', href: '/sick-leave' }];
    case 'REQUESTS':
      return [{ label: 'Заявки', href: '/requests' }];
    case 'NOTIFICATIONS':
      return [{ label: 'Уведомления', href: '/notifications' }];
    default:
      return [];
  }
}

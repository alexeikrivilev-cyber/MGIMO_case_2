/**
 * Zod-схемы входных данных apps/web (ARCHITECTURE §4: «валидация всех
 * входных данных на границе API»). Каждый маршрут разбирает тело/query
 * только через эти схемы — до любого обращения к packages/core и БД.
 *
 * Схемы заявки и решения по верификации НЕ дублируются: канонические
 * версии живут в packages/core (единый контракт с сервисами), здесь
 * они реэкспортируются, чтобы маршруты имели одну точку импорта.
 *
 * Про логин: пароль на входе проверяется только на «непустая строка»
 * (максимум 128). Минимальная длина пароля — знание формы регистрации,
 * а не секрет, но проверка её ЗДЕСЬ создала бы оракул: «нет такого
 * пользователя» (401) vs «пароль слишком короткий» (400) — и перебором
 * логинов можно было бы узнавать, кто зарегистрирован. Поэтому все
 * некорректные credentials дают один обобщённый ответ.
 */
import { z } from 'zod';

/** Логин университетской учётной записи (как в сидере: student1). */
const LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const LOGIN_MESSAGE = 'Логин: от 3 до 64 символов — буквы, цифры, точка, дефис, подчёркивание.';

/** Дата в формате YYYY-MM-DD (как хранятся @db.Date). */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Вход по логину/паролю
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1, 'Укажите логин.')
    .max(64, LOGIN_MESSAGE)
    .regex(LOGIN_PATTERN, LOGIN_MESSAGE),
  // Намеренно БЕЗ минимальной длины: см. комментарий файла.
  password: z.string().min(1, 'Укажите пароль.').max(128, 'Пароль слишком длинный.'),
});

// ---------------------------------------------------------------------------
// Регистрация через VK ID / MAX / Telegram (эмуляция OAuth)
// ---------------------------------------------------------------------------

/** Провайдер из пути: всё остальное — 404 (маршрут не существует). */
export const oauthProviderSchema = z.enum(['vk_id', 'max', 'telegram']);

/** Путь провайдера → код в БД (OAuthProvider). */
export const OAUTH_PROVIDER_BY_PATH: Record<z.infer<typeof oauthProviderSchema>, 'VK_ID' | 'MAX' | 'TELEGRAM'> = {
  vk_id: 'VK_ID',
  max: 'MAX',
  telegram: 'TELEGRAM',
};

/** Начало согласия: необязательные предзаполненные данные формы. */
export const oauthStartSchema = z
  .object({
    login: z.string().trim().max(64, LOGIN_MESSAGE).optional(),
    fullName: z.string().trim().max(200, 'ФИО слишком длинное.').optional(),
    groupName: z.string().trim().max(100, 'Название группы слишком длинное.').optional(),
  })
  .default({});

/**
 * Callback согласия: ФИО и группа обязательны (требование BRIEF v2 —
 * без них студента нельзя посадить в группу и показать расписание).
 * Логин НЕ обязателен: студент вошёл через провайдера, а не придумывал
 * логин. Если логин не передан, он выводится из идентификатора аккаунта
 * провайдера (см. route.ts) — требование BRIEF v2 соблюдено.
 *
 * providerAccountId — идентификатор «аккаунта провайдера» из эмуляции
 * согласия: если такая привязка уже есть, callback выполняет вход в
 * существующего студента вместо создания нового.
 */
export const oauthCallbackSchema = z.object({
  state: z.string().trim().min(8, 'Некорректная ссылка согласия.').max(128),
  login: z
    .string()
    .trim()
    .min(3, LOGIN_MESSAGE)
    .max(64, LOGIN_MESSAGE)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/, LOGIN_MESSAGE)
    .optional(),
  fullName: z
    .string()
    .trim()
    .min(5, 'Укажите ФИО полностью: фамилия, имя и отчество.')
    .max(200, 'ФИО слишком длинное.'),
  groupName: z
    .string()
    .trim()
    .min(1, 'Укажите группу.')
    .max(100, 'Название группы слишком длинное.'),
  providerAccountId: z.string().trim().max(128, 'Некорректный идентификатор аккаунта.').optional(),
});

/**
 * Пароль для новых учётных записей (создаётся в рамках OAuth-регистрации
 * случайный). Правила те же, что в packages/core assertPassword.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Пароль должен содержать не менее 8 символов.')
  .max(128, 'Пароль должен содержать не более 128 символов.');

// ---------------------------------------------------------------------------
// Верификация студбилета
// ---------------------------------------------------------------------------

/**
 * Поле формы верификации (multipart). Номер карточки и файл проверяет
 * packages/core (verificationSubmitSchema) — здесь только быстрый отсев
 * на границе, чтобы не читать лишние мегабайты.
 *
 * Регулярка намеренно повторяет core-схему (кириллица в кодах направлений
 * УдГУ вроде «ПИ-2023-0138»): расхождение дало бы 400 на валидный номер.
 */
export const verificationSubmitSchema = z.object({
  cardNumber: z
    .string()
    .trim()
    .min(4, 'Номер студенческого билета слишком короткий')
    .max(32, 'Номер студенческого билета слишком длинный')
    .regex(/^[\p{L}\p{N}-]+$/u, 'Номер может содержать только буквы, цифры и дефис'),
});

// ---------------------------------------------------------------------------
// Заявки и справки (каноническая схема — в packages/core)
// ---------------------------------------------------------------------------

export { requestFormSchema as requestCreateSchema } from '@udgu/core';

// ---------------------------------------------------------------------------
// Статус «болею»
// ---------------------------------------------------------------------------

/**
 * Статус «болею»: граница маршрута POST /api/sick-leave (multipart).
 * Дата — YYYY-MM-DD (как хранятся @db.Date); причина необязательна.
 * Необязательное фото справки проверяется в самом маршруте (MIME/размер)
 * и уходит в приватное хранилище packages/core; путь в БД пишет
 * createMySickLeave — здесь он не принимается извне.
 */
export const sickLeaveMultipartSchema = z.object({
  dateFrom: z.string().regex(DATE_KEY, 'Дата начала в формате YYYY-MM-DD'),
  dateTo: z.string().regex(DATE_KEY, 'Дата окончания в формате YYYY-MM-DD'),
  reason: z.string().trim().max(500, 'Причина слишком длинная (максимум 500 символов).').optional(),
});

// ---------------------------------------------------------------------------
// Отзыв (решение сотрудника) по верификации — каноническая схема в core
// ---------------------------------------------------------------------------

export { verificationReviewSchema } from '@udgu/core';

// ---------------------------------------------------------------------------
// Query-параметры
// ---------------------------------------------------------------------------

/** Расписание: вид (today|week) и смещение недели. */
export const scheduleQuerySchema = z.object({
  view: z.enum(['today', 'week']).default('today'),
  offset: z.coerce.number().int().min(-52, 'Смещение вне допустимого диапазона.').max(52, 'Смещение вне допустимого диапазона.').default(0),
});

/** Успеваемость: необязательный фильтр по семестру (пустая строка = все). */
export const gradesQuerySchema = z.object({
  semester: z
    .preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      z.coerce.number().int().min(1, 'Номер семестра — целое число от 1.').max(20, 'Номер семестра вне диапазона.'),
    )
    .optional(),
});

/**
 * Тело POST /api/grades/leverage: целевой средний балл на шкале УдГУ
 * (2–5). Расчёт делает packages/core (calculateLeverage) — на клиенте
 * формула не дублируется.
 */
export const leverageBodySchema = z.object({
  targetGpa: z
    .number()
    .min(2, 'Целевой средний балл должен быть в диапазоне 2-5.')
    .max(5, 'Целевой средний балл должен быть в диапазоне 2-5.'),
});

// ---------------------------------------------------------------------------
// Ассистент студента (/api/assistant)
// ---------------------------------------------------------------------------

/**
 * Тело POST /api/assistant — вопрос ассистенту (BRIEF v2 §5).
 *
 * Границы: непустая строка до 500 символов. В вопросе НЕТ и не может быть
 * идентификатора владельца данных: сервис ассистента принимает только
 * сессию и сам резолвит студента (правило ownership.ts), поэтому вопрос
 * «покажи оценки student2» отвечает по данным владельца сессии.
 */
export const assistantQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Напишите вопрос.')
    .max(500, 'Вопрос слишком длинный: максимум 500 символов.'),
});

// ---------------------------------------------------------------------------
// Ассистент преподавателя (/api/teacher/*, BRIEF v2 §5)
// ---------------------------------------------------------------------------

/**
 * Загрузка учебного плана (POST /api/teacher/study-plans, multipart).
 * Название плана проверяется здесь; файл (MIME, размер, кодировка) —
 * packages/core (uploadStudyPlan): одно правило на сервис и маршрут.
 */
export const studyPlanUploadSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Укажите название плана.')
    .max(120, 'Название плана слишком длинное (максимум 120 символов).'),
});

/**
 * Вопрос ассистенту преподавателя (POST /api/teacher/assistant).
 * planId необязателен: без него отвечает самый свежий план преподавателя.
 * Идентификатор плана — uuid: чужой план отдаёт 404 (packages/core,
 * NOT_OWNER), мусорный идентификатор отсеивается ещё до обращения к БД.
 */
export const teacherAssistantQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Напишите вопрос.')
    .max(500, 'Вопрос слишком длинный: максимум 500 символов.'),
  planId: z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Некорректный идентификатор плана.',
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// Кабинет сотрудника деканата (/api/staff/*)
// ---------------------------------------------------------------------------

/**
 * Решение сотрудника по заявке (POST /api/staff/requests/[id]/decide).
 * Каноническая схема — в packages/core (staffRequestDecisionSchema):
 * REJECTED требует непустой комментарий, допустимые статусы
 * IN_PROGRESS/READY/REJECTED. Здесь — реэкспорт, чтобы маршруты имели
 * одну точку импорта (как requestCreateSchema/verificationReviewSchema).
 */
export {
  staffRequestDecisionSchema,
  staffAnnouncementSchema,
  staffScheduleRangeSchema,
  staffLessonMoveSchema,
  staffLessonCancelSchema,
  staffSickLeavesFilterSchema,
  staffVerificationsFilterSchema,
} from '@udgu/core';

/**
 * Фильтр очереди заявок (GET /api/staff/requests?status=): статус
 * необязателен, пустая строка = все статусы (схема core преобразит).
 */
export const staffRequestsQuerySchema = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'READY', 'REJECTED']).optional(),
});

/** Фильтр очереди верификаций (GET /api/staff/verifications?status=). */
export const staffVerificationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
});

/**
 * Расписание сотрудника (GET /api/staff/schedule?from&to): период
 * обязателен (иначе выборка «всех пар факультета» раздувает ответ).
 */
export const staffScheduleQuerySchema = z.object({
  from: z.string().regex(DATE_KEY, 'Дата начала в формате YYYY-MM-DD'),
  to: z.string().regex(DATE_KEY, 'Дата окончания в формате YYYY-MM-DD'),
});

/** Список болезней (GET /api/staff/sick-leaves?onlyActive&from&to). */
export const staffSickLeavesQuerySchema = z.object({
  onlyActive: z.enum(['true', 'false']).default('false'),
  from: z.string().regex(DATE_KEY, 'Дата начала в формате YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_KEY, 'Дата окончания в формате YYYY-MM-DD').optional(),
});

/** Идентификатор сущности в пути (заявка, уведомление). */
export const idParamSchema = z.string().trim().min(1, 'Идентификатор не указан.').max(64, 'Некорректный идентификатор.');

// ---------------------------------------------------------------------------
// Переписка студент ↔ преподаватель (/api/conversations/*)
// ---------------------------------------------------------------------------

/**
 * Начало диалога (POST /api/conversations): идентификатор преподавателя
 * из справочника. Каноническая схема — в packages/core
 * (conversationStartSchema): диалог создаёт только верифицированный
 * студент, проверка живёт в сервисе, здесь — точка импорта для роута.
 */
// ---------------------------------------------------------------------------
// Каналы доступа (/api/bot/*, BRIEF v3)
// ---------------------------------------------------------------------------

/**
 * Канал доступа: telegram | vk | max (BOT_CHANNELS packages/core).
 *
 * Одноимённость с core не случайна: канал определяет и провайдера OAuth
 * (botChannelProvider), и адаптер, и демо-идентификатор аккаунта.
 */
export const botChannelSchema = z.enum(['telegram', 'vk', 'max']);

/** Максимум символов команды из канала (ядро режет тексты заявок и вопросов). */
export const BOT_MESSAGE_MAX_LENGTH = 1000;

/**
 * Тело POST /api/bot/link-code: для какого канала выдать код привязки.
 *
 * Канал обязателен: код, выданный на Telegram, не должен привязать VK
 * (createBotLinkCode(session, provider) проверяет это на стороне ядра).
 */
export const botLinkCodeSchema = z.object({
  channel: botChannelSchema,
});

/**
 * Тело POST /api/bot/message: канал и текст команды.
 *
 * ВАЖНО (граница безопасности): поля channelUserId в схеме НЕТ, и это не
 * невнимательность. Идентификатор аккаунта канала выводится из сессии
 * (demo-<канал>-<userId>, lib/bot/demo-channel.ts): принять его из тела
 * означало бы позволить клиенту назваться чужим аккаунтом мессенджера и
 * работать с чужим кабинетом. Неизвестные поля zod отбрасывает.
 */
export const botMessageSchema = z.object({
  channel: botChannelSchema,
  text: z
    .string()
    .trim()
    .min(1, 'Введите команду.')
    .max(BOT_MESSAGE_MAX_LENGTH, `Команда длиннее ${BOT_MESSAGE_MAX_LENGTH} символов. Сократите её.`),
});


// ---------------------------------------------------------------------------
// Переписка студент ↔ преподаватель (/api/conversations/*)
// ---------------------------------------------------------------------------

/**
 * Начало диалога (POST /api/conversations) и текст сообщения
 * (POST /api/conversations/[id]/messages). Канонические схемы — в
 * packages/core: диалог создаёт только верифицированный студент, проверка
 * живёт в сервисе, здесь — точка импорта для роута.
 */
export { conversationStartSchema, messageBodySchema } from '@udgu/core';

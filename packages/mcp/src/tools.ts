/**
 * Инструменты MCP-сервера деканата (BRIEF v2 §7).
 *
 * ГРАНИЦА (главное правило пакета): инструмент — тонкая обёртка над
 * сервисом кабинета. Он валидирует аргументы (zod) и вызывает ТОТ ЖЕ
 * сервис packages/core, который вызывает веб-кабинет, поэтому:
 *   - своих прав у инструмента нет: их проверяет ядро (requireStaffScope,
 *     владение данными), сервер только отображает отказ;
 *   - данные наружу уходят в той же форме, что в кабинете: ни одного
 *     внутреннего поля (storagePath, путь к фото справки) не добавлено
 *     и не убрано «руками» — сервисы кабинета их и так не отдают.
 *
 * Один инструмент = одно действие сотрудника, которое он делает в
 * кабинете: посмотреть очередь, решить заявку, опубликовать объявление,
 * перенести пару, посмотреть успеваемость студента. Ничего, чего
 * сотрудник не может сделать в кабинете, здесь тоже нельзя.
 */
import { z } from 'zod';
import {
  addUtcDays,
  cancelStaffLesson,
  createStaffAnnouncement,
  dateKey,
  decideStaffRequest,
  getTeacherCard,
  listStaffAnnouncements,
  listStaffGroups,
  listStaffRequests,
  listStaffSchedule,
  listStaffSickLeaves,
  listStudentGradesForStaff,
  listTeachers,
  moveStaffLesson,
  startOfUtcDay,
  ValidationError,
  type AuthSession,
  type StaffLessonItem,
} from '@udgu/core';

/** Горизонт расписания по умолчанию, дни (как в кабинете сотрудника). */
const SCHEDULE_HORIZON_DAYS = 14;

/** Горизонт расписания преподавателя по умолчанию, дни (как в /teachers). */
const TEACHER_HORIZON_DAYS = 14;

/**
 * Группа не найдена в институте сотрудника.
 *
 * Отказ через ValidationError ядра с кодом NOT_FOUND — тот же класс и
 * тот же код, которым teachers.ts отвечает на неизвестного
 * преподавателя: инструмент сверяется со справочником института
 * (listStaffGroups), а не выдумывает группу.
 */
function groupNotFound(groupName: string): Error {
  return new ValidationError('NOT_FOUND', `Группа «${groupName}» не найдена в вашем институте.`);
}

/** Определение инструмента: имя, описание для агента, схема, вызов. */
export interface DeaneryTool {
  readonly name: string;
  /** Человекочитаемое название (для UI клиента и логов). */
  readonly title: string;
  /** Описание для агента: что делает и какие данные возвращает. */
  readonly description: string;
  /** Схема аргументов: валидация входа + inputSchema в tools/list. */
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** Вызов: сессия сотрудника + аргументы → данные кабинета. */
  readonly handler: (session: AuthSession, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Определение инструмента с точной типизацией аргументов: схема задаёт
 * форму args, поэтому обработчик не делает приведений типов вручную.
 */
interface ToolDefinition<Shape extends z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly schema: z.ZodObject<Shape>;
  readonly handler: (session: AuthSession, args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): DeaneryTool {
  // Схема проверяет аргументы на входе, поэтому общий вид обработчика
  // (Record<string, unknown>) безопасен: до него доходят только
  // валидные данные.
  return definition as unknown as DeaneryTool;
}

// ---------------------------------------------------------------------------
// Схемы аргументов
// ---------------------------------------------------------------------------

const requestStatusSchema = z.enum(['NEW', 'IN_PROGRESS', 'READY', 'REJECTED']);
const requestDecisionSchema = z.enum(['IN_PROGRESS', 'READY', 'REJECTED']);
const announcementAudienceSchema = z.enum(['ALL', 'FACULTY', 'GROUP']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD');

export const DEANERY_TOOLS: readonly DeaneryTool[] = [
  defineTool({
    name: 'deanery_requests_list',
    title: 'Очередь заявок',
    description:
      'Список заявок и справок студентов института сотрудника (у администратора — всех институтов). ' +
      'Опционально — фильтр по статусу. Порядок как в кабинете: сначала новые.',
    schema: z.object({
      status: requestStatusSchema.optional(),
    }),
    handler: (session, args) => listStaffRequests(session, { status: args.status }),
  }),

  defineTool({
    name: 'deanery_request_decide',
    title: 'Решение по заявке',
    description:
      'Меняет статус заявки: IN_PROGRESS (в работе), READY (готова) или REJECTED (отклонена). ' +
      'Для отказа обязателен staffComment с причиной — студент получит его в уведомление. ' +
      'Заявка чужого института → отказ по правам.',
    schema: z.object({
      requestId: z.string().min(1, 'Укажите идентификатор заявки.'),
      status: requestDecisionSchema,
      staffComment: z.string().max(1000, 'Комментарий слишком длинный (максимум 1000 символов).').optional(),
    }),
    handler: (session, args) =>
      decideStaffRequest(session, args.requestId, { status: args.status, staffComment: args.staffComment }),
  }),

  defineTool({
    name: 'deanery_announcements_list',
    title: 'Объявления',
    description:
      'Объявления, видимые сотруднику: общие на весь университет, его института и группы его института. ' +
      'Закреплённые — сверху.',
    schema: z.object({}),
    handler: (session) => listStaffAnnouncements(session),
  }),

  defineTool({
    name: 'deanery_announcement_publish',
    title: 'Публикация объявления',
    description:
      'Публикует объявление и уведомляет студентов аудитории. Аудитория по умолчанию — институт ' +
      'сотрудника (факультет берётся из сессии, указывать его не нужно). ALL — только для ' +
      'администратора. Для аудитории GROUP нужен groupId — группа своего института.',
    schema: z.object({
      title: z.string().trim().min(1, 'Укажите заголовок.').max(200, 'Заголовок слишком длинный (максимум 200).'),
      body: z.string().trim().min(1, 'Укажите текст объявления.').max(4000, 'Текст слишком длинный (максимум 4000).'),
      audience: announcementAudienceSchema.optional(),
      groupId: z.string().trim().min(1).optional(),
      faculty: z.string().trim().max(200).optional(),
      pinned: z.boolean().optional(),
    }),
    handler: (session, args) =>
      createStaffAnnouncement(session, {
        title: args.title,
        body: args.body,
        audience: args.audience ?? 'FACULTY',
        groupId: args.groupId,
        faculty: args.faculty,
        pinned: args.pinned ?? false,
      }),
  }),

  defineTool({
    name: 'deanery_sick_leaves',
    title: 'Статусы «болею»',
    description:
      'Студенты института сотрудника, отметившие болезнь. activeOnly=true — только те, кто болеет ' +
      'сейчас. Необязательные from/to (YYYY-MM-DD) ограничивают период. Наличие справки видно ' +
      'фактом (hasAttachment), сами файлы не отдаются.',
    schema: z.object({
      activeOnly: z.boolean().optional(),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
    }),
    handler: (session, args) =>
      listStaffSickLeaves(session, { onlyActive: args.activeOnly ?? false, from: args.from, to: args.to }),
  }),

  defineTool({
    name: 'deanery_schedule',
    title: 'Расписание института',
    description:
      'Пары групп института сотрудника за период (по умолчанию — две недели от сегодня). ' +
      'groupName фильтрует по группе; если группы нет в вашем институте — отказ NOT_FOUND.',
    schema: z.object({
      groupName: z.string().trim().min(1).max(50).optional(),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
    }),
    handler: async (session, args) => {
      const today = startOfUtcDay(new Date());
      const from = args.from ?? dateKey(today);
      const to = args.to ?? dateKey(addUtcDays(today, SCHEDULE_HORIZON_DAYS - 1));
      const lessons: StaffLessonItem[] = await listStaffSchedule(session, { from, to });
      if (args.groupName === undefined) {
        return lessons;
      }
      // Фильтр по группе: сначала ищем группу в справочнике института
      // сотрудника, чтобы «нет такой группы» было честным отказом, а не
      // молчаливым пустым списком (агент иначе решит, что пар нет).
      const groups = await listStaffGroups(session);
      const wanted = args.groupName.trim().toLowerCase();
      const group = groups.find((item) => item.name.toLowerCase() === wanted);
      if (group === undefined) {
        throw groupNotFound(args.groupName);
      }
      return lessons.filter((lesson) => lesson.groupName === group.name);
    },
  }),

  defineTool({
    name: 'deanery_lesson_move',
    title: 'Перенос пары',
    description:
      'Переносит занятие на новую дату (YYYY-MM-DD), опционально меняет аудиторию и добавляет ' +
      'примечание. Студенты группы получают уведомление. Пара чужого института → отказ по правам.',
    schema: z.object({
      lessonId: z.string().min(1, 'Укажите идентификатор занятия.'),
      date: dateSchema,
      room: z.string().trim().max(50, 'Номер аудитории слишком длинный.').optional(),
      note: z.string().trim().max(500, 'Примечание слишком длинное (максимум 500 символов).').optional(),
    }),
    handler: (session, args) =>
      moveStaffLesson(session, args.lessonId, { date: args.date, room: args.room, note: args.note }),
  }),

  defineTool({
    name: 'deanery_lesson_cancel',
    title: 'Отмена пары',
    description:
      'Отменяет занятие; причина обязательна — студенты увидят её в уведомлении. ' +
      'Пара чужого института → отказ по правам.',
    schema: z.object({
      lessonId: z.string().min(1, 'Укажите идентификатор занятия.'),
      reason: z.string().trim().min(1, 'Укажите причину отмены.').max(500, 'Причина слишком длинная (максимум 500 символов).'),
    }),
    handler: (session, args) => cancelStaffLesson(session, args.lessonId, { reason: args.reason }),
  }),

  defineTool({
    name: 'deanery_teachers_list',
    title: 'Преподаватели',
    description: 'Справочник преподавателей университета: ФИО, кафедра, должность. Алфавитно по фамилии.',
    schema: z.object({}),
    handler: (session) => listTeachers(session),
  }),

  defineTool({
    name: 'deanery_teacher_card',
    title: 'Карточка преподавателя',
    description:
      'Расписание преподавателя и часы приёма. Период по умолчанию — две недели от сегодня; ' +
      'dateFrom/dateTo (YYYY-MM-DD) задают его явно. Неизвестный идентификатор → NOT_FOUND.',
    schema: z.object({
      teacherId: z.string().min(1, 'Укажите идентификатор преподавателя.'),
      dateFrom: dateSchema.optional(),
      dateTo: dateSchema.optional(),
    }),
    handler: async (session, args) => {
      const from = startOfUtcDay(new Date());
      const to = addUtcDays(from, TEACHER_HORIZON_DAYS - 1);
      const dateFrom = args.dateFrom === undefined ? from : new Date(`${args.dateFrom}T00:00:00.000Z`);
      const dateTo = args.dateTo === undefined ? to : new Date(`${args.dateTo}T00:00:00.000Z`);
      return getTeacherCard(session, args.teacherId, dateFrom, dateTo);
    },
  }),

  defineTool({
    name: 'deanery_student_grades',
    title: 'Успеваемость студента',
    description:
      'Оценки и зачёты студента по его логину: семестры, оценки, средний балл, долги. ' +
      'Сотрудник видит студентов своего института, администратор — всех. ' +
      'Чужой институт и неизвестный логин дают один и тот же отказ по правам.',
    schema: z.object({
      login: z.string().trim().min(1, 'Укажите логин студента.').max(64, 'Логин слишком длинный.'),
    }),
    handler: (session, args) => listStudentGradesForStaff(session, { login: args.login }),
  }),
];

/** Инструмент по имени; undefined — имени нет в наборе. */
export function findDeaneryTool(name: string): DeaneryTool | undefined {
  return DEANERY_TOOLS.find((item) => item.name === name);
}

/**
 * JSON Schema инструмента для tools/list.
 *
 * z.toJSONSchema отдаёт черновик 2020-12; MCP ждёт «просто схему», поэтому
 * служебное поле $schema убираем. Описания полей остаются на стороне
 * инструмента (description), чтобы агент читал одно место, а не два.
 */
export function inputSchemaOf(schema: DeaneryTool['schema']): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _dropped, ...rest } = jsonSchema;
  return rest;
}

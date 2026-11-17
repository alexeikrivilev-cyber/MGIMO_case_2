/**
 * Заявки и справки: создание, история, просмотр своей заявки, отмена.
 *
 * Все функции принимают сессию и резолвят studentId сами (правило
 * ownership.ts). getMyRequest бросает OwnershipError для чужой заявки —
 * ответ не отличается от «не существует», чтобы перебором идентификаторов
 * нельзя было узнать чужие заявки.
 *
 * Отмена возможна только в статусе NEW: дальше заявку взял в работу
 * сотрудник деканата, и отмена — уже не решение студента.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStudent } from '../ownership';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import type { AuthSession } from '../session';
import type { Prisma, RequestStatus, RequestType } from '@udgu/db';

/** Максимум полей в форме и максимальная длина значения. */
const MAX_FORM_FIELDS = 12;
const MAX_FIELD_KEY_LENGTH = 64;
const MAX_FIELD_VALUE_LENGTH = 1000;

/** Схема формы заявки (граница API: валидация до записи в БД). */
export const requestFormSchema = z.object({
  type: z.enum(['REFERENCE', 'APPLICATION'], {
    message: 'Тип заявки: REFERENCE или APPLICATION',
  }),
  formData: z
    .record(
      z.string().min(1).max(MAX_FIELD_KEY_LENGTH),
      z.string().max(MAX_FIELD_VALUE_LENGTH),
    )
    .refine((value) => Object.keys(value).length >= 1, 'Форма заявки не заполнена')
    .refine(
      (value) => Object.keys(value).length <= MAX_FORM_FIELDS,
      `Слишком много полей: максимум ${MAX_FORM_FIELDS}`,
    ),
});

export type CreateMyRequestInput = z.infer<typeof requestFormSchema>;

export const REQUEST_TYPE_LABELS: Readonly<Record<RequestType, string>> = {
  REFERENCE: 'Справка',
  APPLICATION: 'Заявление',
};

export const REQUEST_STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  READY: 'Готова',
  REJECTED: 'Отклонена',
};

export interface MyRequest {
  readonly id: string;
  readonly type: RequestType;
  readonly typeLabel: string;
  readonly status: RequestStatus;
  readonly statusLabel: string;
  readonly formData: Record<string, string>;
  readonly staffComment: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toMyRequest(request: {
  id: string;
  type: RequestType;
  status: RequestStatus;
  formData: Prisma.JsonValue;
  staffComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MyRequest {
  return {
    id: request.id,
    type: request.type,
    typeLabel: REQUEST_TYPE_LABELS[request.type],
    status: request.status,
    statusLabel: REQUEST_STATUS_LABELS[request.status],
    formData: asStringRecord(request.formData),
    staffComment: request.staffComment,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

/**
 * Приводит JSON из БД к Record<string,string>. Защитная нормализация:
 * испорченная/чужая форма не роняет страницу и не отдаёт нестроковые
 * значения в UI.
 */
function asStringRecord(value: Prisma.JsonValue): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = typeof item === 'string' ? item : String(item);
  }
  return result;
}

/**
 * Создаёт заявку от имени студента сессии. Статус всегда NEW.
 * Студенту приходит уведомление о создании (требование BRIEF: статусы
 * заявок видны в ленте), действие пишется в аудит.
 */
export async function createMyRequest(
  session: AuthSession,
  input: CreateMyRequestInput,
): Promise<MyRequest> {
  const { studentId } = requireStudent(session);
  const parsed = requestFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные заявки.', firstIssues(parsed.error));
  }
  const { type, formData } = parsed.data;

  const student = await prisma().student.findUnique({
    where: { id: studentId },
    select: { userId: true },
  });
  if (student === null) {
    throw new ValidationError('NOT_FOUND', 'Профиль студента не найден. Обратитесь в деканат.');
  }

  const request = await prisma().request.create({
    data: { studentId, type, formData, status: 'NEW' },
  });

  await prisma().notification.create({
    data: {
      userId: student.userId,
      type: 'REQUEST_STATUS',
      title: 'Заявка создана',
      body: `${REQUEST_TYPE_LABELS[type]} принята в работу. Отслеживайте статус в разделе «Заявки».`,
      link: '/requests',
    },
  });

  await writeAuditEvent({
    actorUserId: student.userId,
    action: 'request.create',
    entity: 'Request',
    entityId: request.id,
    meta: { type },
  });

  return toMyRequest(request);
}

/** История заявок студента (сначала новые). */
export async function getMyRequests(session: AuthSession): Promise<MyRequest[]> {
  const { studentId } = requireStudent(session);
  const requests = await prisma().request.findMany({
    where: { studentId },
    orderBy: { createdAt: 'desc' },
  });
  return requests.map(toMyRequest);
}

/**
 * Своя заявка по идентификатору. Чужая или несуществующая заявка →
 * OwnershipError (единый ответ, чтобы не различать «нет» и «не твоя»).
 */
export async function getMyRequest(session: AuthSession, requestId: string): Promise<MyRequest> {
  const { studentId } = requireStudent(session);
  if (typeof requestId !== 'string' || requestId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор заявки не указан.');
  }

  const request = await prisma().request.findUnique({ where: { id: requestId } });
  if (request === null || request.studentId !== studentId) {
    throw new OwnershipError('NOT_OWNER', 'Заявка не найдена или недоступна.');
  }
  return toMyRequest(request);
}

/**
 * Отменяет свою заявку — только в статусе NEW. Уже взятая сотрудником
 * заявка отмене не подлежит (статус IN_PROGRESS и дальше).
 *
 * Статус «отменена студентом» выражается через REJECTED + staffComment:
 * в модели данных отдельного статуса CANCELLED нет (FSM заявок — четыре
 * состояния), а комментарий однозначно указывает, кто закрыл заявку.
 */
export async function cancelMyRequest(session: AuthSession, requestId: string): Promise<MyRequest> {
  const { studentId } = requireStudent(session);
  if (typeof requestId !== 'string' || requestId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор заявки не указан.');
  }

  const request = await prisma().request.findUnique({ where: { id: requestId } });
  if (request === null || request.studentId !== studentId) {
    throw new OwnershipError('NOT_OWNER', 'Заявка не найдена или недоступна.');
  }
  if (request.status !== 'NEW') {
    throw new ValidationError(
      'CONFLICT',
      'Отмена возможна только для новой заявки: она уже взята в работу.',
    );
  }

  const cancelled = await prisma().request.update({
    where: { id: request.id },
    data: { status: 'REJECTED', staffComment: 'Отменена студентом' },
  });

  const student = await prisma().student.findUnique({
    where: { id: studentId },
    select: { userId: true },
  });
  if (student !== null) {
    await prisma().notification.create({
      data: {
        userId: student.userId,
        type: 'REQUEST_STATUS',
        title: 'Заявка отменена',
        body: 'Вы отменили заявку. При необходимости создайте новую.',
        link: '/requests',
      },
    });
    await writeAuditEvent({
      actorUserId: student.userId,
      action: 'request.cancel',
      entity: 'Request',
      entityId: cancelled.id,
      meta: { type: cancelled.type },
    });
  }

  return toMyRequest(cancelled);
}

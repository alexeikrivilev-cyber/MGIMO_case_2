/**
 * Заявки и справки в кабинете сотрудника деканата: очередь по факультету
 * и решение по заявке (ARCHITECTURE §4, BRIEF v2 §6).
 *
 * Владение: сотрудник видит заявки ТОЛЬКО студентов своего факультета
 * (facultyStudentFilter), чужая заявка по идентификатору → NOT_OWNER
 * (→ 404: ответ не отличается от «не существует», анти-IDOR).
 *
 * Переходы статусов (FSM заявки):
 *   NEW → IN_PROGRESS → READY
 *   NEW | IN_PROGRESS → REJECTED (только с непустым комментарием)
 *   READY | REJECTED → терминальные состояния, дальше ничего.
 * Повторный переход в тот же статус — CONFLICT (заявка уже там):
 * иначе сотрудник плодил бы дублирующие уведомления студенту.
 *
 * Каждое решение: уведомление студенту (type REQUEST_STATUS) + запись
 * аудита с actor = сотрудник сессии.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStaffScope, facultyStudentFilter, type StaffScope } from './staff-scope';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from './requests';
import type { AuthSession } from '../session';
import type { Prisma, RequestStatus, RequestType } from '@udgu/db';

/** Статусы, из которых заявка ещё может изменяться сотрудником. */
const OPEN_STATUSES: readonly RequestStatus[] = ['NEW', 'IN_PROGRESS'];

/** Схема фильтра очереди (query ?status=). */
export const staffRequestsFilterSchema = z.object({
  status: z
    .enum(['NEW', 'IN_PROGRESS', 'READY', 'REJECTED'])
    .optional(),
});

export type StaffRequestsFilter = z.infer<typeof staffRequestsFilterSchema>;

/** Схема решения сотрудника по заявке. REJECTED требует комментарий. */
export const staffRequestDecisionSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'READY', 'REJECTED']),
    staffComment: z.string().max(1000, 'Комментарий слишком длинный (максимум 1000 символов).').optional(),
  })
  .refine(
    (value) => value.status !== 'REJECTED' || (value.staffComment ?? '').trim().length > 0,
    'Для отказа нужен комментарий (причина).',
  );

export type StaffRequestDecision = z.infer<typeof staffRequestDecisionSchema>;

/** Заявка в очереди сотрудника: с ФИО и группой студента. */
export interface StaffRequestItem {
  readonly id: string;
  readonly type: RequestType;
  readonly typeLabel: string;
  readonly status: RequestStatus;
  readonly statusLabel: string;
  readonly formData: Record<string, string>;
  readonly staffComment: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly student: {
    readonly id: string;
    readonly fullName: string;
    readonly groupName: string;
    readonly faculty: string;
  };
}

const STUDENT_SELECT = {
  id: true,
  lastName: true,
  firstName: true,
  middleName: true,
  faculty: true,
  group: { select: { name: true } },
} as const;

function studentFullName(student: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}): string {
  return student.middleName === null
    ? `${student.lastName} ${student.firstName}`
    : `${student.lastName} ${student.firstName} ${student.middleName}`;
}

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

function toStaffRequestItem(request: {
  id: string;
  type: RequestType;
  status: RequestStatus;
  formData: Prisma.JsonValue;
  staffComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  student: {
    id: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    faculty: string;
    group: { name: string };
  };
}): StaffRequestItem {
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
    student: {
      id: request.student.id,
      fullName: studentFullName(request.student),
      groupName: request.student.group.name,
      faculty: request.student.faculty,
    },
  };
}

/** Очередь заявок: факультет сотрудника, сначала новые. */
export async function listStaffRequests(
  session: AuthSession,
  filter: StaffRequestsFilter = {},
): Promise<StaffRequestItem[]> {
  const scope = requireStaffScope(session);
  const parsed = staffRequestsFilterSchema.safeParse(filter);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный фильтр заявок.', firstIssues(parsed.error));
  }

  const requests = await prisma().request.findMany({
    where: {
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...facultyStudentFilter(scope),
    },
    include: { student: { select: STUDENT_SELECT } },
    // Сначала новые (NEW), затем по дате: сотрудник работает очередь
    // сверху вниз, а не ищет свежие заявки среди старых.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });

  return requests.map(toStaffRequestItem);
}

/**
 * Решение сотрудника по заявке: статус + комментарий. Валидирует переход,
 * пишет уведомление студенту и аудит. Чужая заявка → NOT_OWNER (404).
 */
export async function decideStaffRequest(
  session: AuthSession,
  requestId: string,
  input: StaffRequestDecision,
): Promise<StaffRequestItem> {
  const scope = requireStaffScope(session);
  const parsed = staffRequestDecisionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректное решение по заявке.', firstIssues(parsed.error));
  }
  if (typeof requestId !== 'string' || requestId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор заявки не указан.');
  }
  const { status, staffComment } = parsed.data;

  const request = await prisma().request.findUnique({
    where: { id: requestId },
    include: { student: { select: STUDENT_SELECT } },
  });

  // Единый ответ для «не существует» и «чужого факультета» (NOT_OWNER).
  if (request === null || !inScope(scope, request.student.faculty)) {
    throw new OwnershipError('NOT_OWNER', 'Заявка не найдена или недоступна.');
  }

  if (!OPEN_STATUSES.includes(request.status)) {
    throw new ValidationError(
      'CONFLICT',
      `Заявка уже закрыта: статус «${REQUEST_STATUS_LABELS[request.status]}».`,
    );
  }
  if (request.status === status) {
    throw new ValidationError(
      'CONFLICT',
      `Заявка уже в статусе «${REQUEST_STATUS_LABELS[status]}».`,
    );
  }

  const updated = await prisma().request.update({
    where: { id: request.id },
    data: { status, staffComment: staffComment?.trim() || null },
    include: { student: { select: STUDENT_SELECT } },
  });

  const studentUser = await prisma().student.findUnique({
    where: { id: request.student.id },
    select: { userId: true },
  });
  if (studentUser !== null) {
    await prisma().notification.create({
      data: {
        userId: studentUser.userId,
        type: 'REQUEST_STATUS',
        title: decisionTitle(status),
        body: decisionBody(request.type, status, staffComment?.trim()),
        link: '/requests',
      },
    });
  }

  await writeAuditEvent({
    actorUserId: scope.user.id,
    action: 'request.decide',
    entity: 'Request',
    entityId: updated.id,
    meta: { status, comment: staffComment?.trim() ?? null },
  });

  return toStaffRequestItem(updated);
}

/** Факультет студента в области видимости сотрудника? */
function inScope(scope: StaffScope, faculty: string): boolean {
  return scope.allFaculties || faculty === scope.faculty;
}

function decisionTitle(status: RequestStatus): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'Заявка взята в работу';
    case 'READY':
      return 'Заявка готова';
    case 'REJECTED':
      return 'Заявка отклонена';
    default:
      return 'Статус заявки изменён';
  }
}

function decisionBody(
  type: RequestType,
  status: RequestStatus,
  comment: string | undefined,
): string {
  const label = REQUEST_TYPE_LABELS[type];
  switch (status) {
    case 'IN_PROGRESS':
      return `${label} взята в работу. Отслеживайте статус в разделе «Заявки».`;
    case 'READY':
      return `${label} готова. Получите её в деканате.`;
    case 'REJECTED':
      return comment === undefined || comment === '' ? `${label} отклонена.` : `${label} отклонена. ${comment}`;
    default:
      return `Статус заявки изменён на «${REQUEST_STATUS_LABELS[status]}».`;
  }
}

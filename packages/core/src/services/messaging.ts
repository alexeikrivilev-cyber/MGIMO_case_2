/**
 * Переписка студент ↔ преподаватель (BRIEF v2 §4, ARCHITECTURE §4).
 *
 * Правила, зафиксированные здесь:
 * - переписка доступна ТОЛЬКО верифицированному студенту: преподаватель
 *   должен понимать, кто пишет (верифицированная личность: ФИО, группа) —
 *   иначе диалог теряет смысл и становится каналом анонимных жалоб.
 *   Гейт проверяется на сервере (requireVerifiedStudent), не только в UI;
 * - диалог — пара (студент, преподаватель), уникальная
 *   (Conversation @@unique([studentId, teacherId])): повторное «написать»
 *   не плодит второй диалог с той же историей;
 * - владение диалогом проверяется по паре studentId/teacherId СЕССИИ:
 *   чужой conversationId → NOT_OWNER (→ 404, ответ не отличается от
 *   «не существует», анти-IDOR, проверяется тестом);
 * - преподаватель видит ФИО и ГРУППУ автора в каждом диалоге (требование
 *   BRIEF v2) — поэтому peer студента несёт groupName;
 * - непрочитанные считаются по сообщениям ДРУГОГО автора без readAt:
 *   счётчик обновляется, когда получатель открыл диалог (markConversationRead).
 *
 * Модель уведомлений: каждое сообщение создаёт получателю уведомление
 * типа MESSAGE со ссылкой на /messages — переписка не должна зависеть
 * от того, открыт ли диалог прямо сейчас.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStudent, requireUser } from '../ownership';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import { requireVerifiedStudent } from './verification';
import type { AuthSession, SessionUser } from '../session';

/** Максимальная длина сообщения (как у комментариев сотрудника). */
export const MAX_MESSAGE_LENGTH = 4000;

/** Тело сообщения: непустое после обрезки пробелов. */
export const messageBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Введите текст сообщения.')
    .max(MAX_MESSAGE_LENGTH, `Сообщение слишком длинное (максимум ${MAX_MESSAGE_LENGTH} символов).`),
});

export type MessageInput = z.infer<typeof messageBodySchema>;

/** Начало диалога: идентификатор преподавателя из справочника. */
export const conversationStartSchema = z.object({
  teacherId: z.string().trim().min(1, 'Выберите преподавателя.').max(64, 'Некорректный идентификатор преподавателя.'),
});

export type ConversationStartInput = z.infer<typeof conversationStartSchema>;

/** Собеседник диалога: преподаватель (для студента) или студент (для преподавателя). */
export interface ConversationPeer {
  /** Идентификатор преподавателя (режим студента) или студента (режим преподавателя). */
  readonly id: string;
  readonly fullName: string;
  /** Группа студента — её видит преподаватель (требование BRIEF v2). */
  readonly groupName: string | null;
  /** Кафедра и должность — их видит студент. */
  readonly department: string | null;
  readonly position: string | null;
}

/** Диалог в списке: собеседник, последнее сообщение, счётчик непрочитанных. */
export interface ConversationListItem {
  readonly id: string;
  readonly peer: ConversationPeer;
  readonly lastMessage: {
    readonly body: string;
    readonly createdAt: Date;
    /** Автор последнего сообщения — владелец сессии? */
    readonly mine: boolean;
  } | null;
  readonly unreadCount: number;
  readonly updatedAt: Date;
}

/** Сообщение в диалоге. */
export interface ConversationMessageItem {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly authorUserId: string;
  /** Автор — владелец сессии (не «прочитано», а «моё»). */
  readonly mine: boolean;
  /** Когда собеседник прочитал (null — ещё нет). */
  readonly readAt: Date | null;
}

/** Диалог с сообщениями. */
export interface ConversationDetail {
  readonly id: string;
  readonly peer: ConversationPeer;
  readonly messages: readonly ConversationMessageItem[];
  readonly unreadCount: number;
}

const TEACHER_SELECT = {
  id: true,
  userId: true,
  lastName: true,
  firstName: true,
  middleName: true,
  department: true,
  position: true,
} as const;

const STUDENT_SELECT = {
  id: true,
  userId: true,
  lastName: true,
  firstName: true,
  middleName: true,
  group: { select: { name: true } },
} as const;

function fullNameOf(person: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}): string {
  return person.middleName === null
    ? `${person.lastName} ${person.firstName}`
    : `${person.lastName} ${person.firstName} ${person.middleName}`;
}

/**
 * Режим переписки по сессии: студент, преподаватель или «не участник»
 * (сотрудник деканата и админ перепиской не пользуются — их инструменты
 * другие, см. кабинет STAFF).
 */
export type MessagingRole = 'student' | 'teacher' | 'none';

/** Определяет режим переписки из сессии (чистая функция, без БД). */
export function messagingRole(user: SessionUser): MessagingRole {
  if (user.role === 'STUDENT') {
    return 'student';
  }
  if (typeof user.teacherId === 'string' && user.teacherId !== '') {
    return 'teacher';
  }
  return 'none';
}

/** Условие выборки диалогов сессии: свои диалоги, и никакие иные. */
function conversationWhere(user: SessionUser): { studentId: string } | { teacherId: string } {
  if (user.role === 'STUDENT') {
    return { studentId: user.studentId as string };
  }
  return { teacherId: user.teacherId as string };
}

const CONVERSATION_INCLUDE = {
  student: { select: STUDENT_SELECT },
  teacher: { select: TEACHER_SELECT },
  messages: {
    select: { id: true, body: true, createdAt: true, authorUserId: true, readAt: true },
    orderBy: { createdAt: 'asc' },
  },
} as const;

type ConversationRow = {
  id: string;
  updatedAt: Date;
  student: {
    id: string;
    userId: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    group: { name: string };
  };
  teacher: {
    id: string;
    userId: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    department: string;
    position: string;
  };
  messages: {
    id: string;
    body: string;
    createdAt: Date;
    authorUserId: string;
    readAt: Date | null;
  }[];
};

/** Собеседник с точки зрения владельца сессии. */
function peerOf(row: ConversationRow, role: MessagingRole): ConversationPeer {
  return role === 'student'
    ? {
        id: row.teacher.id,
        fullName: fullNameOf(row.teacher),
        groupName: null,
        department: row.teacher.department,
        position: row.teacher.position,
      }
    : {
        id: row.student.id,
        fullName: fullNameOf(row.student),
        // Группа автора — то, без чего преподаватель не понимает, кто пишет.
        groupName: row.student.group.name,
        department: null,
        position: null,
      };
}

function unreadCountOf(row: ConversationRow, userId: string): number {
  return row.messages.filter((message) => message.authorUserId !== userId && message.readAt === null).length;
}

function toListItem(row: ConversationRow, userId: string, role: MessagingRole): ConversationListItem {
  const last = row.messages[row.messages.length - 1];
  return {
    id: row.id,
    peer: peerOf(row, role),
    lastMessage:
      last === undefined
        ? null
        : { body: last.body, createdAt: last.createdAt, mine: last.authorUserId === userId },
    unreadCount: unreadCountOf(row, userId),
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: ConversationRow, userId: string, role: MessagingRole): ConversationDetail {
  return {
    id: row.id,
    peer: peerOf(row, role),
    messages: row.messages.map((message) => ({
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      authorUserId: message.authorUserId,
      mine: message.authorUserId === userId,
      readAt: message.readAt,
    })),
    unreadCount: unreadCountOf(row, userId),
  };
}

/**
 * Список диалогов владельца сессии: студент видит диалоги с преподавателями,
 * преподаватель — диалоги, где ему пишут студенты. Свежие сверху.
 *
 * Гейт верификации: студент без подтверждённого студбилета получает
 * VerificationRequiredError (→ 403 VERIFICATION_REQUIRED) — переписка
 * закрыта до сверки (BRIEF v2).
 */
export async function listMyConversations(session: AuthSession): Promise<ConversationListItem[]> {
  const user = requireUser(session);
  const role = messagingRole(user);
  if (role === 'student') {
    await requireVerifiedStudent(session);
  }
  if (role === 'none') {
    throw new OwnershipError(
      'FORBIDDEN_ROLE',
      'Переписка доступна студентам и преподавателям.',
    );
  }

  const conversations = await prisma().conversation.findMany({
    where: conversationWhere(user),
    include: CONVERSATION_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });

  return conversations.map((row) => toListItem(row as ConversationRow, user.id, role));
}

/**
 * Диалог с сообщениями. Владение: пара (studentId, teacherId) должна
 * принадлежать сессии, иначе NOT_OWNER — ответ не отличается от
 * «не существует» (проверка подстановкой conversationId).
 */
export async function getConversation(
  session: AuthSession,
  conversationId: string,
): Promise<ConversationDetail> {
  const user = requireUser(session);
  const role = messagingRole(user);
  if (role === 'none') {
    throw new OwnershipError('FORBIDDEN_ROLE', 'Переписка доступна студентам и преподавателям.');
  }
  if (role === 'student') {
    await requireVerifiedStudent(session);
  }
  if (typeof conversationId !== 'string' || conversationId === '') {
    throw new ValidationError('NOT_FOUND', 'Диалог не найден.');
  }

  const row = await loadOwnConversation(user, conversationId, role);
  return toDetail(row, user.id, role);
}

/** Загружает диалог и проверяет, что он принадлежит сессии. */
async function loadOwnConversation(
  user: SessionUser,
  conversationId: string,
  role: MessagingRole,
): Promise<ConversationRow> {
  const row = await prisma().conversation.findUnique({
    where: { id: conversationId },
    include: CONVERSATION_INCLUDE,
  });
  if (row === null) {
    throw new OwnershipError('NOT_OWNER', 'Диалог не найден или недоступен.');
  }
  const owner = role === 'student' ? row.student.id === user.studentId : row.teacher.id === user.teacherId;
  if (!owner) {
    throw new OwnershipError('NOT_OWNER', 'Диалог не найден или недоступен.');
  }
  return row as ConversationRow;
}

/**
 * Студент начинает диалог с преподавателем (или открывает существующий —
 * пара уникальна). Преподаватель начинать диалог не может: инициатива
 * принадлежит студенту, иначе любой преподаватель мог бы написать кому угодно.
 */
export async function startConversationWithTeacher(
  session: AuthSession,
  input: ConversationStartInput,
): Promise<ConversationDetail> {
  const { user, studentId } = requireStudent(session);
  await requireVerifiedStudent(session);

  const parsed = conversationStartSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный выбор преподавателя.', firstIssues(parsed.error));
  }
  const { teacherId } = parsed.data;

  const teacher = await prisma().teacher.findUnique({
    where: { id: teacherId },
    select: { id: true },
  });
  if (teacher === null) {
    throw new ValidationError('NOT_FOUND', 'Преподаватель не найден.');
  }

  // Повторное обращение к тому же преподавателю открывает тот же диалог.
  const conversation = await prisma().conversation.upsert({
    where: { studentId_teacherId: { studentId, teacherId } },
    create: { studentId, teacherId },
    update: {},
    select: { id: true },
  });

  await writeAuditEvent({
    actorUserId: user.id,
    action: 'conversation.start',
    entity: 'Conversation',
    entityId: conversation.id,
    meta: { teacherId },
  });

  const row = await loadOwnConversation(user, conversation.id, 'student');
  return toDetail(row, user.id, 'student');
}

/**
 * Отправляет сообщение в диалог. Получатель получает уведомление
 * (type MESSAGE, ссылка на /messages), updatedAt диалога обновляется —
 * по нему список сортирует свежие диалоги.
 */
export async function sendMessage(
  session: AuthSession,
  conversationId: string,
  input: MessageInput,
): Promise<ConversationMessageItem> {
  const user = requireUser(session);
  const role = messagingRole(user);
  if (role === 'none') {
    throw new OwnershipError('FORBIDDEN_ROLE', 'Переписка доступна студентам и преподавателям.');
  }
  if (role === 'student') {
    await requireVerifiedStudent(session);
  }

  const parsed = messageBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректное сообщение.', firstIssues(parsed.error));
  }
  const conversation = await loadOwnConversation(user, conversationId, role);

  const message = await prisma().message.create({
    data: {
      conversationId: conversation.id,
      authorUserId: user.id,
      body: parsed.data.body,
    },
    select: { id: true, body: true, createdAt: true, authorUserId: true, readAt: true },
  });

  // updatedAt держит индекс «свежие диалоги сверху» (@@index([teacherId, updatedAt])).
  await prisma().conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  // Получатель — пользователь «другой стороны» диалога (userId приходит
  // из связи: у студента и преподавателя всегда есть учётная запись,
  // иначе диалог не существовал бы).
  const recipientUserId = role === 'student' ? conversation.teacher.userId : conversation.student.userId;
  await prisma().notification.create({
    data: {
      userId: recipientUserId,
      type: 'MESSAGE',
      title: role === 'student' ? 'Новое сообщение от студента' : 'Новое сообщение от преподавателя',
      body: preview(parsed.data.body),
      link: '/messages',
    },
  });

  await writeAuditEvent({
    actorUserId: user.id,
    action: 'message.send',
    entity: 'Conversation',
    entityId: conversation.id,
    meta: null,
  });

  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    authorUserId: message.authorUserId,
    mine: true,
    readAt: message.readAt,
  };
}

/**
 * Отмечает диалог прочитанным: readAt проставляется сообщениям ДРУГОГО
 * автора без readAt. Возвращает количество отмеченных сообщений.
 */
export async function markConversationRead(
  session: AuthSession,
  conversationId: string,
): Promise<number> {
  const user = requireUser(session);
  const role = messagingRole(user);
  if (role === 'none') {
    throw new OwnershipError('FORBIDDEN_ROLE', 'Переписка доступна студентам и преподавателям.');
  }
  if (role === 'student') {
    await requireVerifiedStudent(session);
  }
  const conversation = await loadOwnConversation(user, conversationId, role);

  const result = await prisma().message.updateMany({
    where: {
      conversationId: conversation.id,
      authorUserId: { not: user.id },
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  return result.count;
}

/** Короткое превью сообщения для уведомления (без обрезки слов). */
function preview(body: string): string {
  const LIMIT = 120;
  return body.length <= LIMIT ? body : `${body.slice(0, LIMIT - 1)}…`;
}

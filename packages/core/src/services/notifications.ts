/**
 * Уведомления студента: лента, счётчик непрочитанных, отметка о прочтении.
 *
 * Уведомления адресуются пользователю (userId), поэтому все фильтры
 * идут по userId из сессии — чужое уведомление недоступно даже по
 * идентификатору (проверка владения в markNotificationRead).
 */
import { prisma } from '../db';
import { requireUser } from '../ownership';
import { OwnershipError, ValidationError } from '../errors';
import type { AuthSession } from '../session';
import type { NotificationType } from '@udgu/db';

/** Лимит выдачи ленты: последние 100 уведомлений. */
const NOTIFICATIONS_LIMIT = 100;

export interface MyNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
  readonly link: string | null;
  readonly createdAt: Date;
}

/** Лента уведомлений пользователя сессии (сначала новые). */
export async function getMyNotifications(session: AuthSession): Promise<MyNotification[]> {
  const user = requireUser(session);
  const notifications = await prisma().notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: NOTIFICATIONS_LIMIT,
  });
  return notifications.map((notification) => ({
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    read: notification.read,
    link: notification.link,
    createdAt: notification.createdAt,
  }));
}

/** Число непрочитанных уведомлений (бейдж в кабинете). */
export async function getMyUnreadCount(session: AuthSession): Promise<number> {
  const user = requireUser(session);
  return prisma().notification.count({ where: { userId: user.id, read: false } });
}

/**
 * Отмечает уведомление прочитанным. Идемпотентно для своего уведомления;
 * чужое или несуществующее → OwnershipError (единый ответ).
 */
export async function markNotificationRead(session: AuthSession, id: string): Promise<void> {
  const user = requireUser(session);
  if (typeof id !== 'string' || id === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор уведомления не указан.');
  }
  const result = await prisma().notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true },
  });
  if (result.count === 0) {
    throw new OwnershipError('NOT_OWNER', 'Уведомление не найдено или недоступно.');
  }
}

/** Отмечает прочитанными все уведомления пользователя сессии. */
export async function markAllRead(session: AuthSession): Promise<{ updated: number }> {
  const user = requireUser(session);
  const result = await prisma().notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
  return { updated: result.count };
}

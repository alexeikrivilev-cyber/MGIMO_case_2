/**
 * Аудит безопасности и действий (модель AuditEvent).
 *
 * Каждое изменение владельцем данных (заявка, болезнь, верификация)
 * и каждое решение сотрудника фиксируются здесь: «кто/что/когда».
 * Аудит — не отладочный лог: в нём нет персональных данных сверх
 * необходимого и никогда нет паролей, токенов и содержимого форм.
 */
import { Prisma, prisma } from './db';

/** Допустимые значения метаданных события. */
export type AuditMetaValue = string | number | boolean | null;

export interface WriteAuditEventInput {
  readonly actorUserId: string;
  readonly action: string;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly meta?: Record<string, AuditMetaValue> | null;
}

/**
 * Записывает событие аудита. meta=null явно обнуляет JSON-поле,
 * meta отсутствует — поле не трогается.
 */
export async function writeAuditEvent(input: WriteAuditEventInput): Promise<string> {
  const { actorUserId, action, entity, entityId, meta } = input;

  if (actorUserId === '' || action === '' || entity === '') {
    throw new TypeError('Аудит: actorUserId, action и entity обязательны.');
  }

  const record = await prisma().auditEvent.create({
    data: {
      actorUserId,
      action,
      entity,
      entityId: entityId ?? null,
      meta:
        meta === undefined
          ? undefined
          : meta === null
            ? Prisma.JsonNull
            : (meta as Record<string, AuditMetaValue>),
    },
    select: { id: true },
  });

  return record.id;
}

/** События аудита по сущности (для кабинета сотрудника, P2). */
export async function getAuditTrail(
  entity: string,
  entityId: string,
  limit = 50,
): Promise<
  readonly {
    id: string;
    action: string;
    actorUserId: string;
    createdAt: Date;
  }[]
> {
  const events = await prisma().auditEvent.findMany({
    where: { entity, entityId },
    select: { id: true, action: true, actorUserId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return events;
}

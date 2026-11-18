/**
 * Объявления деканата в кабинете сотрудника: публикация и список
 * (BRIEF v2 §6, ARCHITECTURE §4).
 *
 * АУДИТОРИЯ (решение зафиксировано здесь явно):
 *   - ALL (весь университет) — ТОЛЬКО ADMIN. Сотрудник института не
 *     рассылает сообщения всему вузу: это решение уровня администратора
 *     (400 INVALID_INPUT с пояснением — аудитория не секрет, скрывать
 *     нечего, в отличие от чужих данных);
 *   - FACULTY — институт СОТРУДНИКА, берётся из сессии (не из тела
 *     запроса!): иначе сотрудник публиковал бы в чужой факультет;
 *   - GROUP — группа ТОГО ЖЕ факультета: чужая группа → NOT_OWNER (404,
 *     ответ не отличается от «не существует»).
 *   ADMIN (faculty = null, allFaculties) публикует FACULTY/GROUP, указав
 *   факультет явно: faculty в теле принимается ТОЛЬКО у ADMIN, у STAFF
 *   такое поле запрещено (400) — молчаливого игнора не будет.
 *
 * Каждая публикация: уведомления студентам аудитории (type ANNOUNCEMENT)
 * + аудит (actor = сотрудник сессии).
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStaffScope, type StaffScope } from './staff-scope';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import { ANNOUNCEMENT_AUDIENCE_LABELS } from './announcements';
import { enqueueChannelDeliveriesSafely } from '../bot/outbox';
import type { AuthSession } from '../session';
import type { AnnouncementAudience } from '@udgu/db';

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;

/** Схема публикации объявления (граница API + сервис). */
export const staffAnnouncementSchema = z.object({
  title: z.string().trim().min(1, 'Укажите заголовок.').max(MAX_TITLE_LENGTH, `Заголовок слишком длинный (максимум ${MAX_TITLE_LENGTH}).`),
  body: z.string().trim().min(1, 'Укажите текст объявления.').max(MAX_BODY_LENGTH, `Текст слишком длинный (максимум ${MAX_BODY_LENGTH}).`),
  audience: z.enum(['ALL', 'FACULTY', 'GROUP'], {
    message: 'Аудитория: ALL, FACULTY или GROUP',
  }),
  /** Идентификатор группы — обязателен только для audience=GROUP. */
  groupId: z.string().trim().min(1).max(64).optional(),
  pinned: z.boolean().default(false),
  /** Факультет — ТОЛЬКО для ADMIN с audience=FACULTY (см. комментарий файла). */
  faculty: z.string().trim().max(200).optional(),
});

/**
 * Вход публикации: pinned опционален (zod подставит false по умолчанию),
 * поэтому используем z.input — иначе вызывающий код был бы обязан
 * передавать pinned явно.
 */
export type StaffAnnouncementInput = z.input<typeof staffAnnouncementSchema>;

/** Объявление в списке сотрудника. */
export interface StaffAnnouncementItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  readonly audienceLabel: string;
  readonly faculty: string | null;
  readonly groupName: string | null;
  readonly pinned: boolean;
  readonly publishedAt: Date;
}

export async function createStaffAnnouncement(
  session: AuthSession,
  input: StaffAnnouncementInput,
): Promise<StaffAnnouncementItem> {
  const scope = requireStaffScope(session);
  const parsed = staffAnnouncementSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные объявления.', firstIssues(parsed.error));
  }
  const { title, body, audience, groupId, pinned, faculty } = parsed.data;

  let facultyValue: string | null;
  let groupIdValue: string | null = null;

  if (audience === 'ALL') {
    // Решение по аудитории ALL: только ADMIN (см. комментарий файла).
    if (!scope.allFaculties) {
      throw new ValidationError(
        'INVALID_INPUT',
        'Общие объявления для всего университета публикует администратор. Выберите аудиторию «Институт» или «Группа».',
      );
    }
    facultyValue = null;
  } else if (audience === 'FACULTY') {
    facultyValue = resolveFaculty(scope, faculty);
  } else {
    // GROUP: группа того же факультета, иначе NOT_OWNER (404).
    if (groupId === undefined) {
      throw new ValidationError('INVALID_INPUT', 'Для аудитории «Группа» укажите группу.');
    }
    const group = await prisma().group.findUnique({
      where: { id: groupId },
      select: { faculty: true },
    });
    if (group === null || (scope.allFaculties === false && group.faculty !== scope.faculty)) {
      throw new OwnershipError('NOT_OWNER', 'Группа не найдена или недоступна.');
    }
    facultyValue = group.faculty;
    groupIdValue = groupId;
  }

  const announcement = await prisma().announcement.create({
    data: {
      title,
      body,
      audience,
      faculty: facultyValue,
      groupId: groupIdValue,
      pinned,
      authorId: scope.user.id,
    },
    include: { group: { select: { name: true } } },
  });

  await notifyAudience(audience, facultyValue, groupIdValue, title, body);

  await writeAuditEvent({
    actorUserId: scope.user.id,
    action: 'announcement.create',
    entity: 'Announcement',
    entityId: announcement.id,
    meta: { audience, faculty: facultyValue, groupId: groupIdValue, pinned },
  });

  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    audience: announcement.audience,
    audienceLabel: ANNOUNCEMENT_AUDIENCE_LABELS[announcement.audience],
    faculty: announcement.faculty,
    groupName: announcement.group?.name ?? null,
    pinned: announcement.pinned,
    publishedAt: announcement.publishedAt,
  };
}

/**
 * Факультет объявления FACULTY: у сотрудника — из сессии (не клиент!),
 * у ADMIN — из тела (одного faculty у него нет).
 */
function resolveFaculty(scope: StaffScope, requested: string | undefined): string {
  if (scope.allFaculties) {
    if (requested === undefined || requested === '') {
      throw new ValidationError(
        'INVALID_INPUT',
        'Администратору нужно указать институт для объявления аудитории «Институт».',
      );
    }
    return requested;
  }
  if (requested !== undefined && requested !== scope.faculty) {
    // Молчаливо игнорировать чужой факультет нельзя: подмена аудитории —
    // это попытка опубликоваться не в свой институт.
    throw new ValidationError(
      'INVALID_INPUT',
      'Объявление института публикуется в ваш институт: факультет указывать не нужно.',
    );
  }
  return scope.faculty as string;
}

/** Уведомления студентам аудитории объявления. */
async function notifyAudience(
  audience: AnnouncementAudience,
  faculty: string | null,
  groupId: string | null,
  title: string,
  body: string,
): Promise<void> {
  const where =
    audience === 'GROUP'
      ? { groupId: groupId as string }
      : audience === 'FACULTY'
        ? { faculty: faculty as string }
        : {}; // ALL: все студенты (для ADMIN — весь университет)

  const students = await prisma().student.findMany({
    where,
    select: { userId: true },
  });
  if (students.length === 0) {
    return;
  }

  const notificationTitle = `Объявление деканата: ${title}`;
  await prisma().notification.createMany({
    data: students.map((student) => ({
      userId: student.userId,
      type: 'ANNOUNCEMENT' as const,
      title: notificationTitle,
      body,
      link: '/announcements',
    })),
  });

  // Копия уведомления в каналы каждого студента аудитории (BRIEF v3):
  // тот же заголовок и текст. Сбой outbox не отменяет уведомление на
  // сайте — оно источник истины, поэтому вызов безопасный (и одна
  // строка в лог, а не отказ всей публикации).
  for (const student of students) {
    await enqueueChannelDeliveriesSafely(
      student.userId,
      { title: notificationTitle, body, link: '/announcements' },
      'announcement.create',
    );
  }
}

/**
 * Группы, в которые сотрудник может опубликовать объявление аудитории
 * «Группа»: группы ЕГО института (у ADMIN — все, у него faculty = null).
 *
 * Нужен форме публикации: без справочника пришлось бы вводить
 * идентификатор группы руками, а сотрудник не должен знать (и не может
 * подобрать) идентификаторы групп другого института.
 */
export async function listStaffGroups(
  session: AuthSession,
): Promise<readonly { id: string; name: string }[]> {
  const scope = requireStaffScope(session);
  const groups = await prisma().group.findMany({
    where: scope.allFaculties ? {} : { faculty: scope.faculty as string },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return groups.map((group) => ({ id: group.id, name: group.name }));
}

/**
 * Объявления, видимые сотруднику: весь университет (ALL), его институт
 * и группы его института. Закреплённые — сверху.
 */
export async function listStaffAnnouncements(
  session: AuthSession,
): Promise<StaffAnnouncementItem[]> {
  const scope = requireStaffScope(session);

  const announcements = await prisma().announcement.findMany({
    where: scope.allFaculties
      ? {}
      : {
          OR: [
            { audience: 'ALL' },
            { audience: 'FACULTY', faculty: scope.faculty as string },
            { audience: 'GROUP', faculty: scope.faculty as string },
          ],
        },
    include: { group: { select: { name: true } } },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
  });

  return announcements.map((announcement) => ({
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    audience: announcement.audience,
    audienceLabel: ANNOUNCEMENT_AUDIENCE_LABELS[announcement.audience],
    faculty: announcement.faculty,
    groupName: announcement.group?.name ?? null,
    pinned: announcement.pinned,
    publishedAt: announcement.publishedAt,
  }));
}

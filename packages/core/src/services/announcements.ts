/**
 * Объявления деканата: общие, по институту и по группе студента.
 * Закреплённые — сверху (решение Council: важное не тонет в ленте).
 *
 * Объявления — общедоступная информация кабинета, поэтому фильтр идёт
 * по аудитории + институту/группе студента сессии, а не по «владельцу»:
 * studentId извне не принимается.
 */
import { prisma } from '../db';
import { requireStudent } from '../ownership';
import type { AuthSession } from '../session';
import type { AnnouncementAudience } from '@udgu/db';

export const ANNOUNCEMENT_AUDIENCE_LABELS: Readonly<Record<AnnouncementAudience, string>> = {
  ALL: 'Для всех',
  FACULTY: 'Институт',
  GROUP: 'Группа',
};

export interface AnnouncementItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  readonly audienceLabel: string;
  readonly groupName: string | null;
  readonly pinned: boolean;
  readonly publishedAt: Date;
}

/** Объявления, видимые студенту сессии: ALL + его институт + его группа. */
export async function getAnnouncementsFor(session: AuthSession): Promise<AnnouncementItem[]> {
  const { studentId } = requireStudent(session);

  const student = await prisma().student.findUnique({
    where: { id: studentId },
    select: { faculty: true, groupId: true },
  });
  if (student === null) {
    return [];
  }

  const announcements = await prisma().announcement.findMany({
    where: {
      OR: [
        { audience: 'ALL' },
        { audience: 'FACULTY', faculty: student.faculty },
        { audience: 'GROUP', groupId: student.groupId },
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
    groupName: announcement.group?.name ?? null,
    pinned: announcement.pinned,
    publishedAt: announcement.publishedAt,
  }));
}

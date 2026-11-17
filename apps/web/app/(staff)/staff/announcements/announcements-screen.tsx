/**
 * Экран «Объявления» кабинета сотрудника деканата: публикация и список.
 *
 * Форма публикации сверху (её чаще используют), ниже — опубликованные
 * объявления, видимые сотруднику: весь университет, его институт и
 * группы его института. Закреплённые идут первыми (порядок задаёт
 * packages/core), у каждого видно аудиторию и дату.
 */
import { cookies } from 'next/headers';
import { Card, EmptyState, StatusBadge } from '../../../../components/ui';
import { PageHeader } from '../../../../components/PageHeader';
import { StaffPageResult } from '../../../../components/StaffPageResult';
import { formatMoment } from '../../../../components/format';
import {
  loadStaffAnnouncementsPageData,
  type LoadResult,
  type StaffAnnouncementsPageData,
} from '../../../../lib/page-data';
import { AnnouncementForm } from './AnnouncementForm';

/** Аудитория объявления словами: институт или группа, если известны. */
function audienceText(announcement: StaffAnnouncementsPageData['announcements'][number]): string {
  if (announcement.audience === 'ALL') {
    return 'Весь университет';
  }
  if (announcement.audience === 'FACULTY') {
    return announcement.faculty ?? 'Институт';
  }
  return announcement.groupName === null ? 'Группа' : `Группа · ${announcement.groupName}`;
}

function AnnouncementCard({
  announcement,
}: {
  announcement: StaffAnnouncementsPageData['announcements'][number];
}): React.JSX.Element {
  return (
    <Card data-testid="staff-announcement">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{announcement.title}</h2>
        {announcement.pinned ? <StatusBadge tone="info">Закреплено</StatusBadge> : null}
        <StatusBadge tone="neutral">{audienceText(announcement)}</StatusBadge>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-text-muted">{announcement.body}</p>
      <p className="mt-2 text-xs text-text-muted">Опубликовано {formatMoment(new Date(announcement.publishedAt))}</p>
    </Card>
  );
}

export function StaffAnnouncementsView({
  result,
}: {
  result: LoadResult<StaffAnnouncementsPageData>;
}): React.JSX.Element {
  return (
    <StaffPageResult result={result}>
      {(data) => (
        <>
          <PageHeader
            title="Объявления"
            subtitle="Публикация для института или группы"
            action={
              <span className="text-sm text-text-muted">
                {data.announcements.length === 0 ? '0 объявлений' : `${data.announcements.length} в списке`}
              </span>
            }
          />

          <div className="mb-6">
            <AnnouncementForm groups={data.groups} faculty={data.faculty} allFaculties={data.allFaculties} />
          </div>

          <section aria-labelledby="staff-announcements-list">
            <h2 id="staff-announcements-list" className="mb-2 text-base font-semibold text-text">
              Опубликованные объявления
            </h2>
          {data.announcements.length === 0 ? (
            <EmptyState title="Объявлений нет" />
          ) : (
              <ul className="space-y-3">
                {data.announcements.map((announcement) => (
                  <li key={announcement.id}>
                    <AnnouncementCard announcement={announcement} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </StaffPageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function StaffAnnouncementsScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadStaffAnnouncementsPageData(cookieStore.toString());
  return <StaffAnnouncementsView result={result} />;
}

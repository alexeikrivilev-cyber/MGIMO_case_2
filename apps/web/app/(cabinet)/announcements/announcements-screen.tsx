/**
 * Экран «Объявления»: лента деканата — общие, для института и для
 * группы студента (audience фильтрует сервер packages/core), закреплённые
 * сверху (решение Council: важное не тонет в ленте).
 */
import { cookies } from 'next/headers';
import { Card, EmptyState, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { formatMoment } from '../../../components/format';
import { IconMegaphone } from '../../../components/icons';
import { loadAnnouncementsPageData, type LoadResult, type AnnouncementsPageData } from '../../../lib/page-data';

export function AnnouncementsView({ result }: { result: LoadResult<AnnouncementsPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader title="Объявления" subtitle="Новости деканата для вас" />

          {data.announcements.length === 0 ? (
            <EmptyState title="Объявлений нет" icon={<IconMegaphone />} />
          ) : (
            <ul className="space-y-3">
              {data.announcements.map((announcement) => (
                <li key={announcement.id}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2">
                      {announcement.pinned === true ? <StatusBadge tone="warning">Закреплено</StatusBadge> : null}
                      <StatusBadge tone="neutral">
                        {announcement.audienceLabel}
                        {announcement.audience === 'GROUP' && announcement.groupName !== null
                          ? ` · ${announcement.groupName}`
                          : ''}
                      </StatusBadge>
                      <p className="text-xs text-text-muted">{formatMoment(new Date(announcement.publishedAt))}</p>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-text">{announcement.title}</h2>
                    <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{announcement.body}</p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function AnnouncementsScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadAnnouncementsPageData(cookieStore.toString());
  return <AnnouncementsView result={result} />;
}

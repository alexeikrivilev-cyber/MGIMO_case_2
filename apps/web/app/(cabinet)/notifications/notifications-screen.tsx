/**
 * Экран «Уведомления»: лента с непрочитанными, «отметить все
 * прочитанными» и ссылки на связанные разделы.
 *
 * Список рендерит сервер (данные — те же сервисы packages/core, что и
 * /api/notifications); кнопка «отметить все» — клиентский остров,
 * который после мутации обновляет страницу. Непрочитанные помечены
 * бейджем «Новое» (текст, не только цвет).
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, EmptyState, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { formatMoment } from '../../../components/format';
import { loadNotificationsPageData, type LoadResult, type NotificationsPageData } from '../../../lib/page-data';
import { MarkAllReadButton } from './MarkAllReadButton';
import { TEXT_LINK_SM_CLASS } from '../../../lib/ui';

/** Ссылка уведомления: внутренний адрес — переход, иное — просто текст. */
function NotificationLink({ link, children }: { link: string; children: string }): React.JSX.Element {
  if (link.startsWith('/')) {
    return (
      <Link href={link} className={TEXT_LINK_SM_CLASS}>
        {children}
      </Link>
    );
  }
  return <span className="text-sm text-text-muted">{children}</span>;
}

export function NotificationsView({ result }: { result: LoadResult<NotificationsPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => (
        <>
          <PageHeader
            title="Уведомления"
            subtitle={
              data.unreadCount === 0
                ? 'Все прочитаны'
                : `Непрочитанных: ${data.unreadCount} из ${data.notifications.length}`
            }
          />

          <div className="mb-4">
            <MarkAllReadButton unreadCount={data.unreadCount} />
          </div>

          {data.notifications.length === 0 ? (
            <EmptyState
              title="Уведомлений пока нет"
              description="Деканат присылает сюда объявления, изменения расписания и статусы заявок. После первого события уведомление появится в этой ленте."
            />
          ) : (
            <ul className="space-y-3">
              {data.notifications.map((notification) => (
                <li key={notification.id}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2">
                      {notification.read === true ? null : <StatusBadge tone="info">Новое</StatusBadge>}
                      <h2
                        className={`min-w-0 flex-1 text-base ${notification.read === true ? 'font-medium text-text-muted' : 'font-semibold text-text'}`}
                      >
                        {notification.title}
                      </h2>
                      <p className="text-xs text-text-muted">{formatMoment(new Date(notification.createdAt))}</p>
                    </div>
                    <p className="mt-1.5 text-sm text-text-muted">{notification.body}</p>
                    {notification.link === null ? null : (
                      <div className="mt-2">
                        <NotificationLink link={notification.link}>Перейти к разделу</NotificationLink>
                      </div>
                    )}
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
export async function NotificationsScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadNotificationsPageData(cookieStore.toString());
  return <NotificationsView result={result} />;
}

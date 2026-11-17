/**
 * Экран «Сегодня» (дашборд) — главный экран кабинета.
 *
 * Задача экрана (JTBD из PRD): за 10 секунд понять, что сегодня по
 * учёбе и всё ли в порядке. Поэтому сверху — приветствие, статус
 * верификации и ближайшая пара, ниже — расписание дня, свободные окна
 * («освоенное время», решение Council), заявки с меткой «чей ход»,
 * непрочитанные уведомления и свежие объявления.
 *
 * Данные загружает сервер (DashboardScreen через loadDashboardData —
 * те же сервисы packages/core, что и /api/*); экран презентационный.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Avatar, Card, EmptyState, LinkButton, StatusBadge } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { PageResult, SectionTitle, VerificationGateCard } from '../../components/PageStates';
import { LessonRow } from '../../components/LessonRow';
import { formatDate, formatDayLabel, formatDuration, formatMoment } from '../../components/format';
import { requestTurnLabel, requestStatusTone, verificationStatusTone, VERIFICATION_STATUS_LABELS } from '../../components/labels';
import { loadDashboardData, type DashboardData, type LoadResult } from '../../lib/page-data';
import { TEXT_LINK_SM_CLASS } from '../../lib/ui';
import type { MyRequest } from '@udgu/core';

/** Приветствие по времени суток (локальному). */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** Карточка заявки на дашборде: статус + «чей ход». */
function RequestRow({ request }: { request: MyRequest }): React.JSX.Element {
  const firstField = Object.entries(request.formData)[0];
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1 text-sm text-text">
        {request.typeLabel}
        {firstField === undefined ? null : (
          <span className="text-text-muted"> · {firstField[1]}</span>
        )}
      </span>
      <StatusBadge tone={requestStatusTone(request.status)}>{request.statusLabel}</StatusBadge>
      <StatusBadge tone={requestTurnLabel(request.status) === 'Ваш ход' ? 'warning' : 'neutral'}>
        {requestTurnLabel(request.status)}
      </StatusBadge>
    </li>
  );
}

export function DashboardView({ result }: { result: LoadResult<DashboardData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        const { profile } = data;
        const verified = profile.verificationStatus === 'VERIFIED';

        return (
          <>
            <PageHeader
              title={`${greeting(new Date())}, ${profile.firstName}!`}
              subtitle={`${profile.groupName} · ${formatDate(new Date(`${data.date}T00:00:00.000Z`))}`}
              action={<Avatar initials={profile.avatarInitials} />}
            />

            {/* Статус верификации: призыв действовать, пока билет не подтверждён */}
            {verified === true ? null : (
              <Card className="mb-4 border-warning/40 bg-warning-soft/40">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={verificationStatusTone(profile.verificationStatus)}>
                    {VERIFICATION_STATUS_LABELS[profile.verificationStatus]}
                  </StatusBadge>
                  <p className="min-w-0 flex-1 text-sm text-text-muted">
                    {profile.verificationStatus === 'NO_APPLICATION'
                      ? 'Верифицируйте студенческий билет, чтобы открылись оценки и переписка.'
                      : profile.verificationStatus === 'PENDING'
                        ? 'Заявка на верификацию ждёт решения сотрудника деканата.'
                        : 'Верификация отклонена — проверьте причину и подайте заявку снова.'}
                  </p>
                  <LinkButton href="/verification" variant="secondary">
                    {profile.verificationStatus === 'REJECTED' ? 'Подать снова' : 'Верифицировать'}
                  </LinkButton>
                </div>
              </Card>
            )}

            {/* Ближайшая пара */}
            <Card className="mb-4">
              <SectionTitle>Ближайшая пара</SectionTitle>
              {data.nextLesson === null ? (
                <EmptyState
                  title="Ближайших пар не найдено"
                  description="На горизонте двух недель занятий нет. Проверьте расписание на неделю или расписание преподавателей."
                />
              ) : (
                <div>
                  <p className="text-lg font-semibold text-text">{data.nextLesson.subjectName}</p>
                  <p className="mt-1 text-sm text-text-muted">
                    {formatDayLabel(data.nextLesson.effectiveDate)}, {data.nextLesson.startTime}–
                    {data.nextLesson.endTime} · {data.nextLesson.effectiveRoom}
                  </p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {data.nextLesson.typeLabel} · {data.nextLesson.teacherName}
                  </p>
                  {data.nextLesson.status === 'MOVED' && data.nextLesson.changeHint !== null ? (
                    <p className="mt-2 text-xs text-warning">{data.nextLesson.changeHint}</p>
                  ) : null}
                </div>
              )}
            </Card>

            {/* Расписание на сегодня */}
            <section className="mb-4" aria-labelledby="today-schedule">
              <SectionTitle
                action={
                  <Link href="/schedule" className={TEXT_LINK_SM_CLASS}>
                    Всё расписание
                  </Link>
                }
              >
                <span id="today-schedule">Расписание на сегодня</span>
              </SectionTitle>
              <Card>
                {data.todayLessons.length === 0 ? (
                  <EmptyState
                    title="Сегодня пар нет"
                    description="Сегодня занятий нет — можно спокойно подготовиться к завтрашнему дню или посмотреть расписание на неделю."
                  />
                ) : (
                  <ul>
                    {data.todayLessons.map((lesson) => (
                      <LessonRow key={lesson.id} lesson={lesson} />
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* Свободные окна между парами */}
            {data.freeGaps.length === 0 ? null : (
              <section className="mb-4" aria-labelledby="free-gaps">
                <SectionTitle>
                  <span id="free-gaps">Свободные окна</span>
                </SectionTitle>
                <Card>
                  <p className="mb-2 text-xs text-text-muted">
                    Время между парами — «освоенное время»: его можно потратить на подготовку к следующей паре.
                  </p>
                  <ul className="space-y-1.5">
                    {data.freeGaps.map((gap) => (
                      <li key={`${gap.startTime}-${gap.endTime}`} className="flex items-center justify-between text-sm">
                        <span className="font-medium tabular-nums text-text">
                          {gap.startTime} — {gap.endTime}
                        </span>
                        <span className="text-text-muted">{formatDuration(gap.durationMinutes)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}

            {/* Заявки в работе */}
            <section className="mb-4" aria-labelledby="active-requests">
              <SectionTitle
                action={
                  <Link href="/requests" className={TEXT_LINK_SM_CLASS}>
                    Все заявки
                  </Link>
                }
              >
                <span id="active-requests">Заявки</span>
              </SectionTitle>
              <Card>
                {data.activeRequests.length === 0 ? (
                  <EmptyState
                    title="Активных заявок нет"
                    description="Нужна справка или заявление? Оформите заявку онлайн — она появится здесь со статусом."
                    action={
                      <LinkButton href="/requests" variant="secondary">
                        Перейти к заявкам
                      </LinkButton>
                    }
                  />
                ) : (
                  <ul>
                    {data.activeRequests.map((request) => (
                      <RequestRow key={request.id} request={request} />
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* Непрочитанные уведомления */}
            <section className="mb-4" aria-labelledby="unread-notifications">
              <SectionTitle
                action={
                  <Link href="/notifications" className={TEXT_LINK_SM_CLASS}>
                    Все уведомления
                  </Link>
                }
              >
                <span id="unread-notifications">
                  Непрочитанные уведомления{data.unreadCount > 0 ? ` · ${data.unreadCount}` : ''}
                </span>
              </SectionTitle>
              <Card>
                {data.unreadNotifications.length === 0 ? (
                  <EmptyState
                    title="Все уведомления прочитаны"
                    description="Новых сообщений от деканата нет. Изменения расписания и статусы заявок появятся здесь."
                  />
                ) : (
                  <ul>
                    {data.unreadNotifications.map((notification) => (
                      <li key={notification.id} className="border-b border-border py-2.5 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="info">Новое</StatusBadge>
                          <p className="min-w-0 flex-1 text-sm font-medium text-text">{notification.title}</p>
                        </div>
                        <p className="mt-1 text-sm text-text-muted">{notification.body}</p>
                        <p className="mt-1 text-xs text-text-muted">{formatMoment(new Date(notification.createdAt))}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* Свежие объявления */}
            <section className="mb-4" aria-labelledby="fresh-announcements">
              <SectionTitle
                action={
                  <Link href="/announcements" className={TEXT_LINK_SM_CLASS}>
                    Все объявления
                  </Link>
                }
              >
                <span id="fresh-announcements">Объявления</span>
              </SectionTitle>
              <Card>
                {data.announcements.length === 0 ? (
                  <EmptyState
                    title="Объявлений пока нет"
                    description="Деканат публикует объявления для института и группы — они появятся в этом разделе."
                  />
                ) : (
                  <ul>
                    {data.announcements.map((announcement) => (
                      <li key={announcement.id} className="border-b border-border py-2.5 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {announcement.pinned === true ? <StatusBadge tone="warning">Закреплено</StatusBadge> : null}
                          <StatusBadge tone="neutral">{announcement.audienceLabel}</StatusBadge>
                        </div>
                        <p className="mt-1 text-sm font-medium text-text">{announcement.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-sm text-text-muted">{announcement.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* Успеваемость за гейтом верификации */}
            {data.gradesLocked === false ? null : (
              <section className="mb-4" aria-labelledby="grades-gate">
                <SectionTitle>
                  <span id="grades-gate">Успеваемость</span>
                </SectionTitle>
                <VerificationGateCard />
              </section>
            )}
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка экрана: cookie → данные → вид. */
export async function DashboardScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadDashboardData(cookieStore.toString());
  return <DashboardView result={result} />;
}

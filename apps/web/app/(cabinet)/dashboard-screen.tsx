/**
 * Экран «Сегодня» (дашборд) — главный экран кабинета.
 *
 * Задача экрана (JTBD из PRD): за 10 секунд понять, что сегодня по
 * учёбе и всё ли в порядке. Поэтому сверху — приветствие по имени из
 * профиля и ближайшая пара с меткой «когда», ниже — расписание дня со
 * свободными окнами («освоенное время», решение Council), заявки с
 * меткой «чей ход» и шагами продвижения, непрочитанные уведомления и
 * свежие объявления.
 *
 * Оформление — модуль academic.module.css (дизайн-коммит владельца):
 * герой с циферблатом, листы-секции, плотные editorial-плотности. Хореография
 * входа — единственное место stagger'а в проекте (артефакт волны 1, §3):
 * обёртка .stagger-in из globals.css, только при prefers-reduced-motion:
 * no-preference.
 *
 * Данные загружает сервер (DashboardScreen через loadDashboardData —
 * те же сервисы packages/core, что и /api/*); экран презентационный.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { dateKey } from '@udgu/core';
import { PageHeader } from '../../components/PageHeader';
import { PageResult, VerificationGateCard } from '../../components/PageStates';
import { DayTimeline } from '../../components/DayTimeline';
import { RequestTimeline } from '../../components/RequestTimeline';
import { EmptyState } from '../../components/ui';
import { formatDate, formatDayLabel, formatDuration, formatMoment, lessonMoment } from '../../components/format';
import { requestTurnLabel, VERIFICATION_STATUS_LABELS } from '../../components/labels';
import { IconBell, IconCalendar, IconMegaphone, IconRequests } from '../../components/icons';
import { loadDashboardData, type DashboardData, type LoadResult } from '../../lib/page-data';
import styles from './academic.module.css';

/**
 * Кольцо фокуса из того же модуля: Tailwind-утилита focus-visible: в
 * модульную вёрстку не тащится, поэтому видимый outline (WCAG 2.4.7)
 * несёт класс .focus-visible из academic.module.css. Навешивается на
 * каждый интерактивный элемент экрана явно.
 */
const RING = styles['focus-visible'];

/** Приветствие по времени суток (локальному). */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function SectionHead({ title, href, action }: {title: string; href: string; action: string}) {
  return <header className={styles.sectionHead}><h2>{title}</h2><Link className={RING} href={href}>{action} <span aria-hidden="true">↗</span></Link></header>;
}

/** A timetable dial marks the exact start of the next class. */
function ClassDial({ start }: { start: string }) {
  const [hour = 0, minute = 0] = start.split(':').map(Number);
  return (
    <svg className={styles.dial} viewBox="0 0 180 180" aria-hidden="true">
      <circle cx="90" cy="90" r="83" fill="none" stroke="currentColor" opacity=".2" />
      {Array.from({length: 60}, (_, i) => <line key={i} x1="90" x2="90" y1="10" y2={i % 5 === 0 ? 21 : 14}
        stroke="currentColor" opacity={i % 5 === 0 ? 1 : .35} strokeWidth={i % 5 === 0 ? 2 : 1} transform={`rotate(${i * 6} 90 90)`}/>)}
      <path d="M90 90V46" stroke="currentColor" strokeWidth="5" strokeLinecap="round" transform={`rotate(${hour * 30 + minute * .5} 90 90)`}/>
      <path d="M90 90V28" stroke="var(--udgu-color-primary)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${minute * 6} 90 90)`}/>
      <circle cx="90" cy="90" r="5" fill="var(--udgu-color-primary)" />
    </svg>
  );
}

export function DashboardView({ result, now = new Date() }: {result: LoadResult<DashboardData>; now?: Date}) {
  return <PageResult result={result}>{(data) => {
    const {profile, nextLesson: lesson} = data;
    // Метка «когда» у ближайшей пары: UTC-мгновения (урок волны 2), поэтому
    // «Через 20 ч 30 мин» не зависит от пояса хоста. Только здесь: рельс
    // /schedule несёт свои маркеры (волна 2), а дубля метки на нём нет.
    const timing = lesson ? lessonMoment(now, dateKey(lesson.effectiveDate), lesson.startTime, lesson.endTime) : null;
    const requests = [...data.activeRequests].sort((a, b) => Number(requestTurnLabel(b.status) === 'Ваш ход') - Number(requestTurnLabel(a.status) === 'Ваш ход'));
    return <div className="stagger-in">
      <PageHeader title="Сегодня" subtitle={`${profile.groupName} · ${formatDate(new Date(data.date + 'T00:00:00Z'))}`} />
      <section className={styles.hero} aria-label="Ближайшая пара">
        <div className={styles.heroInfo}>
          <p className={styles.heroGreeting}>{greeting(now)}, {profile.firstName}!</p>
          {lesson ? <>
            <div className={styles.heroLabel}><i aria-hidden="true"/>Ближайшая пара {timing && timing.kind !== 'FAR' && <span className={styles.when}>{timing.label}</span>}</div>
            <h2>{lesson.subjectName}</h2>
            <div className={styles.meeting}><strong>{lesson.startTime}–{lesson.endTime}</strong><span>{formatDayLabel(lesson.effectiveDate)}</span><span>{lesson.effectiveRoom}</span></div>
            <p>{lesson.typeLabel} · {lesson.teacherName}</p>
            {lesson.status === 'MOVED' && <p>{lesson.changeHint}</p>}
          </> : <EmptyState title="Ближайших пар нет" icon={<IconCalendar />}/>}
          <Link className={`${styles.heroLink} ${RING}`} href="/schedule">Открыть расписание <span aria-hidden="true">→</span></Link>
        </div>
        {lesson && <ClassDial start={lesson.startTime}/>}
      </section>
      {profile.verificationStatus !== 'VERIFIED' && <div className={styles.notice}>
        <div><strong>{VERIFICATION_STATUS_LABELS[profile.verificationStatus]}</strong><p>{profile.verificationStatus === 'PENDING' ? 'Студбилет на проверке.' : 'Для доступа к оценкам и переписке нужен подтверждённый студбилет.'}</p></div>
        <Link className={RING} href="/verification">{profile.verificationStatus === 'REJECTED' ? 'Подать снова' : 'Открыть'}</Link>
      </div>}
      <div className={styles.columns}>
        <section className={styles.sheet}>
          <SectionHead title="Расписание на сегодня" href="/schedule" action="Неделя"/>
          {data.todayLessons.length > 0 ? <DayTimeline lessons={data.todayLessons} gaps={data.freeGaps} now={now}/> : <EmptyState title="Сегодня пар нет" icon={<IconCalendar />}/>}
          {data.freeGaps.length > 0 && <div className={styles.gaps}>
            <h3>Свободные окна</h3>
            <ul>{data.freeGaps.map(gap => <li key={`${gap.startTime}-${gap.endTime}`}><strong>{gap.startTime}—{gap.endTime}</strong><span>{formatDuration(gap.durationMinutes)}</span></li>)}</ul>
          </div>}
        </section>
        <section className={styles.sheet}>
          <SectionHead title="Заявки" href="/requests" action="Все заявки"/>
          <ul className={styles.list}>{requests.map(r => <li key={r.id}>
            <strong>{r.typeLabel}</strong><p>{requestTurnLabel(r.status)} · {r.statusLabel}</p>
            <RequestTimeline status={r.status}/>
          </li>)}</ul>
          {requests.length === 0 && <EmptyState title="Активных заявок нет" icon={<IconRequests />}/>}
          <Link className={`${styles.lineAction} ${RING}`} href="/requests?new=1"><span aria-hidden="true">＋</span> Подать заявку</Link>
        </section>
        <section className={styles.sheet}>
          <SectionHead title={`Уведомления${data.unreadCount ? ' · ' + data.unreadCount : ''}`} href="/notifications" action="Все"/>
          {data.unreadNotifications.length === 0 && <EmptyState title="Непрочитанных нет" icon={<IconBell />}/>}
          <ul className={styles.list}>{data.unreadNotifications.map(n => <li key={n.id}><details><summary>{n.title}</summary><p>{n.body}</p></details><small>{formatMoment(new Date(n.createdAt))}</small></li>)}</ul>
        </section>
        <section className={styles.sheet}>
          <SectionHead title="Объявления" href="/announcements" action="Все"/>
          {data.announcements.length === 0 && <EmptyState title="Объявлений нет" icon={<IconMegaphone />}/>}
          <ul className={styles.list}>{data.announcements.map(a => <li key={a.id}><details><summary>{a.title}</summary><p>{a.body}</p></details><small>{a.pinned && 'Закреплено · '}{a.audienceLabel}</small></li>)}</ul>
        </section>
      </div>
      <div className={styles.notice}><strong>Ассистент по учёбе</strong><Link className={RING} href="/assistant">Задать вопрос ↗</Link></div>
      {data.gradesLocked && <VerificationGateCard/>}
    </div>;
  }}</PageResult>;
}

export async function DashboardScreen() {
  const cookieStore = await cookies();
  return <DashboardView result={await loadDashboardData(cookieStore.toString())}/>;
}

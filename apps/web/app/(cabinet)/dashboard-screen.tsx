import { cookies } from 'next/headers';
import Link from 'next/link';
import { dateKey } from '@udgu/core';
import { PageHeader } from '../../components/PageHeader';
import { PageResult, VerificationGateCard } from '../../components/PageStates';
import { DayTimeline } from '../../components/DayTimeline';
import { RequestTimeline } from '../../components/RequestTimeline';
import { formatDate, formatDayLabel, formatMoment, lessonMoment } from '../../components/format';
import { requestTurnLabel, VERIFICATION_STATUS_LABELS } from '../../components/labels';
import { loadDashboardData, type DashboardData, type LoadResult } from '../../lib/page-data';
import styles from './academic.module.css';

function SectionHead({ title, href, action }: {title: string; href: string; action: string}) {
  return <header className={styles.sectionHead}><h2>{title}</h2><Link href={href}>{action} <span aria-hidden="true">↗</span></Link></header>;
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
    const timing = lesson ? lessonMoment(now, dateKey(lesson.effectiveDate), lesson.startTime, lesson.endTime) : null;
    const requests = [...data.activeRequests].sort((a, b) => Number(requestTurnLabel(b.status) === 'Ваш ход') - Number(requestTurnLabel(a.status) === 'Ваш ход'));
    return <div className={styles.board}>
      <PageHeader title="Сегодня" subtitle={`${profile.firstName} · ${profile.groupName} · ${formatDate(new Date(data.date + 'T00:00:00Z'))}`} />
      <section className={styles.hero} aria-labelledby="next-class-title">
        <div className={styles.heroInfo}>
          <div className={styles.heroLabel}><i aria-hidden="true"/>Ближайшая пара {timing && timing.kind !== 'FAR' && <span>{timing.label}</span>}</div>
          <h2 id="next-class-title">{lesson?.subjectName ?? 'Ближайших пар нет'}</h2>
          {lesson && <>
            <div className={styles.meeting}><strong>{lesson.startTime}–{lesson.endTime}</strong><span>{formatDayLabel(lesson.effectiveDate)}</span><span>{lesson.effectiveRoom}</span></div>
            <p>{lesson.typeLabel} · {lesson.teacherName}</p>
            {lesson.status === 'MOVED' && <p>{lesson.changeHint}</p>}
          </>}
          <Link className={styles.heroLink} href="/schedule">Открыть расписание <span aria-hidden="true">→</span></Link>
        </div>
        {lesson && <ClassDial start={lesson.startTime}/>}
      </section>
      {profile.verificationStatus !== 'VERIFIED' && <div className={styles.notice}>
        <div><strong>{VERIFICATION_STATUS_LABELS[profile.verificationStatus]}</strong><p>{profile.verificationStatus === 'PENDING' ? 'Студбилет на проверке.' : 'Для доступа к оценкам и переписке нужен подтверждённый студбилет.'}</p></div>
        <Link href="/verification">{profile.verificationStatus === 'REJECTED' ? 'Подать снова' : 'Открыть'}</Link>
      </div>}
      <div className={styles.columns}>
        <section className={styles.sheet}>
          <SectionHead title="Расписание на сегодня" href="/schedule" action="Неделя"/>
          {data.todayLessons.length > 0 ? <DayTimeline lessons={data.todayLessons} gaps={data.freeGaps} now={now}/> : <p className={styles.empty}>Сегодня пар нет</p>}
        </section>
        <section className={styles.sheet}>
          <SectionHead title="Заявки" href="/requests" action="Все заявки"/>
          <ul className={styles.list}>{requests.map(r => <li key={r.id}>
            <strong>{r.typeLabel}</strong><p>{requestTurnLabel(r.status)} · {r.statusLabel}</p>
            <RequestTimeline status={r.status}/>
          </li>)}</ul>
          {requests.length === 0 && <p className={styles.empty}>Активных заявок нет</p>}
          <Link className={styles.lineAction} href="/requests?new=1"><span aria-hidden="true">＋</span> Подать заявку</Link>
        </section>
        <section className={styles.sheet}>
          <SectionHead title={`Уведомления${data.unreadCount ? ' · ' + data.unreadCount : ''}`} href="/notifications" action="Все"/>
          {data.unreadNotifications.length === 0 && <p className={styles.empty}>Непрочитанных нет</p>}
          <ul className={styles.list}>{data.unreadNotifications.map(n => <li key={n.id}><details><summary>{n.title}</summary><p>{n.body}</p></details><small>{formatMoment(new Date(n.createdAt))}</small></li>)}</ul>
        </section>
        <section className={styles.sheet}>
          <SectionHead title="Объявления" href="/announcements" action="Все"/>
          {data.announcements.length === 0 && <p className={styles.empty}>Объявлений нет</p>}
          <ul className={styles.list}>{data.announcements.map(a => <li key={a.id}><details><summary>{a.title}</summary><p>{a.body}</p></details><small>{a.pinned && 'Закреплено · '}{a.audienceLabel}</small></li>)}</ul>
        </section>
      </div>
      <div className={styles.notice}><strong>Ассистент по учёбе</strong><Link href="/assistant">Задать вопрос ↗</Link></div>
      {data.gradesLocked && <VerificationGateCard/>}
    </div>;
  }}</PageResult>;
}

export async function DashboardScreen() {
  const cookieStore = await cookies();
  return <DashboardView result={await loadDashboardData(cookieStore.toString())}/>;
}

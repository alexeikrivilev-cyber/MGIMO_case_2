'use client';

import { useId, useState, type ReactNode } from 'react';
import styles from '../academic.module.css';

interface Day { date: string; weekday: string; number: string; title: string; count: number; content: ReactNode }

export function WeekDays({ days, initialDate }: { days: Day[]; initialDate: string }) {
  const [active, setActive] = useState(() => Math.max(0, days.findIndex(day => day.date === initialDate)));
  const panelId = useId();
  const selected = days[active];
  if (!selected) return null;
  return <div className={styles.sheet}>
    <div className={styles.weekStrip} role="group" aria-label="Дни недели">
      {days.map((day,i) => <button type="button" key={day.date} aria-pressed={active === i}
        aria-controls={panelId} aria-label={day.title} onClick={() => setActive(i)}>
        <small>{day.weekday}</small><strong>{day.number}</strong>
        <i aria-hidden="true" data-lessons={day.count > 0}/>
      </button>)}
    </div>
    <section id={panelId} className={styles.dayPanel} aria-label={selected.title} key={selected.date}>
      <h2>{selected.title}</h2>{selected.content}
    </section>
  </div>;
}

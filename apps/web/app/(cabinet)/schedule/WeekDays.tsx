'use client';

import { useState, type ReactNode } from 'react';
import styles from '../academic.module.css';

interface Day { date: string; weekday: string; number: string; title: string; count: number; content: ReactNode }

/**
 * Полоса недели: семь дней + панель выбранного.
 *
 * Панели ВСЕХ семи дней рендерит сервер: переносы и отмены живут в
 * разметке недели — их видно без JS, они печатаются и индексируются, —
 * а выбор дня переключает видимость. Невыбранные панели скрыты атрибутом
 * hidden (модуль гасит их display: none), поэтому на экране по-прежнему
 * один день, как и задумано дизайн-коммитом владельца.
 *
 * Кнопка дня управляет СВОЕЙ панелью (aria-controls → id панели), а не
 * одной общей: иначе скринридер связывает «вторник» с чужой панелью.
 */
export function WeekDays({ days, initialDate }: { days: Day[]; initialDate: string }) {
  const [active, setActive] = useState(() => Math.max(0, days.findIndex(day => day.date === initialDate)));
  return <div className={styles.sheet}>
    <div className={styles.weekStrip} role="group" aria-label="Дни недели">
      {days.map((day,i) => <button type="button" key={day.date} className={styles['focus-visible']} aria-pressed={active === i}
        aria-controls={`day-${day.date}`} aria-label={day.title} onClick={() => setActive(i)}>
        <small>{day.weekday}</small><strong>{day.number}</strong>
        <i aria-hidden="true" data-lessons={day.count > 0}/>
      </button>)}
    </div>
    {days.map((day,i) => <section key={day.date} id={`day-${day.date}`} className={styles.dayPanel} aria-label={day.title} hidden={active !== i}>
      <h2>{day.title}</h2>{day.content}
    </section>)}
  </div>;
}

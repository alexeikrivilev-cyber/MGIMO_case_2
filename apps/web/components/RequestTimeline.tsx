/**
 * Таймлайн заявки: шаги продвижения «Новая → В работе → Готова»
 * (docs/design/ui-alive-wave-2.html, раздел 1).
 *
 * Зачем: бейджи статуса отвечают «в каком заявка состоянии», но не
 * «двигалась ли она». Три шага — ровно три «движущихся» статуса, что
 * есть в данных. REJECTED (отказ) — не этап, а исход: для него
 * таймлайна нет вовсе, чтобы отказ не выглядел пустым шагом. Бейджи
 * StatusBadge и «чей ход» на карточке остаются — таймлайн дополняет их.
 *
 * Компонент презентационный и неинтерактивный: чистый серверный рендер,
 * ноль JS. Состояние шага несут форма полосы (залита / пуста) и подпись
 * (полужирная у текущего) плюс aria-current — не только цвет.
 *
 * aria-current сидит на ПОДПИСИ шага: подпись — единственный текст шага,
 * полоса декоративна, поэтому скринридер связывает «текущий шаг» с
 * названием («Готова, текущий шаг»), а не с графикой.
 *
 * Оформление — модуль academic.module.css (.steps): тот же дизайн-язык,
 * что и у остальных экранов кабинета на модуле.
 */
import { REQUEST_STATUS_LABELS } from '@udgu/core';
import type { RequestStatus } from '@udgu/db';
import styles from '../app/(cabinet)/academic.module.css';

/** Шаги продвижения по порядку (отказ — не этап, см. README компонента). */
const STEPS = ['NEW', 'IN_PROGRESS', 'READY'] as const;

export function RequestTimeline({ status }: { status: RequestStatus }) {
  // Отказ — исход, а не этап: таймлайна нет.
  if (status === 'REJECTED') return null;
  const current = STEPS.indexOf(status);
  return <ol aria-label="Статус заявки" className={styles.steps}>
    {STEPS.map((step, i) => <li key={step} data-complete={i < current} data-current={i === current}>
      <i aria-hidden="true"/><span aria-current={i === current ? 'step' : undefined}>{REQUEST_STATUS_LABELS[step]}</span>
    </li>)}
  </ol>;
}

import { REQUEST_STATUS_LABELS } from '@udgu/core';
import type { RequestStatus } from '@udgu/db';
import styles from '../app/(cabinet)/academic.module.css';

const STEPS = ['NEW', 'IN_PROGRESS', 'READY'] as const;

export function RequestTimeline({ status }: { status: RequestStatus }) {
  if (status === 'REJECTED') return null;
  const current = STEPS.indexOf(status);
  return <ol className={styles.steps} aria-label="Статус заявки">
    {STEPS.map((step, i) => <li key={step} aria-current={i === current ? 'step' : undefined} data-complete={i < current}>
      <i aria-hidden="true"/><span>{i < current && <b aria-hidden="true">✓ </b>}{REQUEST_STATUS_LABELS[step]}</span>
    </li>)}
  </ol>;
}

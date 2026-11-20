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
 * ноль JS. Состояние шага несут форма точки (залита / кольцо / полая),
 * подпись (полужирная у текущего) и aria-current — не только цвет.
 * Метки берутся из REQUEST_STATUS_LABELS ядра: второго словаря статусов
 * в кабинете не появляется.
 */
import { Fragment } from 'react';
import { REQUEST_STATUS_LABELS } from '@udgu/core';
import type { RequestStatus } from '@udgu/db';

/** Шаги продвижения по порядку (отказ — не этап, см. README компонента). */
const STEPS: readonly Exclude<RequestStatus, 'REJECTED'>[] = ['NEW', 'IN_PROGRESS', 'READY'];

/** Кольцо текущего шага — через токен primary-soft, без хардкода цвета. */
const NOW_RING = 'shadow-[0_0_0_3px_var(--udgu-color-primary-soft)]';

export function RequestTimeline({ status }: { status: RequestStatus }): React.JSX.Element | null {
  // Отказ — исход, а не этап: таймлайна нет.
  if (status === 'REJECTED') {
    return null;
  }

  const currentIndex = STEPS.indexOf(status);

  return (
    <ol aria-label="Статус заявки" className="mt-3.5 flex items-start px-0.5">
      {STEPS.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isDone = index < currentIndex;
        return (
          <Fragment key={step}>
            {index > 0 ? (
              <li
                aria-hidden="true"
                className={`mt-[5px] h-0.5 flex-1 ${index <= currentIndex ? 'bg-primary' : 'bg-border'}`}
              />
            ) : null}
            <li className="flex flex-col items-center gap-1.5">
              <span
                className={`size-2.5 shrink-0 rounded-full border ${
                  isCurrent === true
                    ? `border-primary bg-primary ${NOW_RING}`
                    : isDone === true
                      ? 'border-primary bg-primary'
                      : 'border-border bg-surface'
                }`}
              />
              {/* aria-current на подписи: подпись — единственный текст шага,
                  точка декоративна, поэтому скринридер вслух связывает
                  «текущий шаг» с названием («В работе, текущий шаг»). */}
              <span
                className={`whitespace-nowrap text-[10px] leading-3 ${
                  isCurrent === true ? 'font-semibold text-text' : 'text-text-muted'
                }`}
                aria-current={isCurrent === true ? 'step' : undefined}
              >
                {REQUEST_STATUS_LABELS[step]}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

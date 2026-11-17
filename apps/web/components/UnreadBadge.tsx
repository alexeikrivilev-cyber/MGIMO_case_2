'use client';

/**
 * Бейдж непрочитанных уведомлений в нижней навигации.
 *
 * Данные — только из /api/notifications (единая точка правды: тот же
 * маршрут, что и страница уведомлений). Счётчик обновляется при
 * монтировании и раз в 30 секунд: после прочтения уведомлений на
 * странице бейдж гаснет без перезагрузки оболочки.
 *
 * Число выводится текстом (не только цвет/кружок) и сопровождается
 * подписью для скринридера — требование WCAG к статусам.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api-client';

/** Период опроса непрочитанных, мс. */
const POLL_INTERVAL_MS = 30_000;

export function UnreadBadge(): React.JSX.Element | null {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    async function load(): Promise<void> {
      try {
        const payload = await api.getNotifications();
        if (alive) {
          setUnread(payload.unreadCount);
        }
      } catch {
        // Недоступность счётчика не должна ломать навигацию: бейдж
        // просто остаётся в последнем известном состоянии.
      }
    }

    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (unread === null || unread === 0) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className="absolute -right-1 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-on-primary"
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

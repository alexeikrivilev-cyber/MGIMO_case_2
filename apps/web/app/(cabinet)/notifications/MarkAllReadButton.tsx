'use client';

/**
 * Кнопка «Отметить все прочитанными» (клиентский остров).
 *
 * POST /api/notifications/read-all через lib/api-client (CSRF клиент
 * добавляет сам). Если непрочитанных нет — кнопка неактивна и объясняет
 * почему: пустое действие без пояснения смущает пользователя.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError, api } from '../../../lib/api-client';
import { Button } from '../../../components/ui';

export function MarkAllReadButton({ unreadCount }: { unreadCount: number }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markAll(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.markAllNotificationsRead();
      router.refresh();
    } catch (markError) {
      setError(
        markError instanceof ApiClientError
          ? markError.message
          : 'Не удалось отметить уведомления. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        onClick={() => void markAll()}
        loading={pending}
        loadingLabel="Отмечаем…"
        disabled={unreadCount === 0}
      >
        Отметить все прочитанными
      </Button>
      {unreadCount === 0 ? (
        <p className="text-xs text-text-muted">Непрочитанных уведомлений нет.</p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

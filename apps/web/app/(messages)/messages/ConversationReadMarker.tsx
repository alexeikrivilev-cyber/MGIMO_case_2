'use client';

/**
 * Отметка о прочтении диалога (клиентский остров).
 *
 * Когда получатель открыл диалог, сообщения другого автора перестают
 * быть «непрочитанными»: POST /api/conversations/[id]/read. После ответа
 * сервера список обновляется — счётчик непрочитанных в навигации и в
 * списке диалогов пересчитывается.
 *
 * Почему эффект, а не серверная отметка при открытии: GET не должен
 * менять данные. Иначе превью ссылки в браузере или поисковый робот
 * «прочитали» бы переписку за владельца.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api-client';

export function ConversationReadMarker({
  conversationId,
  unreadCount,
}: {
  conversationId: string;
  unreadCount: number;
}): React.JSX.Element | null {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'marking' | 'failed'>('idle');

  useEffect(() => {
    if (unreadCount <= 0 || state !== 'idle') {
      return;
    }
    let cancelled = false;
    setState('marking');
    void api
      .markConversationRead(conversationId)
      .then(() => {
        if (cancelled) {
          return;
        }
        router.refresh();
      })
      .catch(() => {
        if (!cancelled) {
          setState('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, unreadCount, router, state]);

  if (unreadCount <= 0) {
    return null;
  }

  return (
    <p role="status" aria-live="polite" className="text-xs text-text-muted">
      {state === 'failed'
        ? 'Не удалось отметить прочитанным. Откройте диалог снова.'
        : `Отмечаем прочитанным: ${unreadCount}`}
    </p>
  );
}

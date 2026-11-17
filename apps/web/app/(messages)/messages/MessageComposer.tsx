'use client';

/**
 * Отправка сообщения в диалоге (клиентский остров переписки).
 *
 * POST /api/conversations/[id]/messages через lib/api-client: CSRF-токен
 * добавляется автоматически, cookie сессии уходит сама. Сервер проверяет
 * гейт верификации (студент), владение диалогом (чужой → 404) и создаёт
 * уведомление получателю; здесь — ввод, отправка и показ результата.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api, MAX_MESSAGE_LENGTH } from '../../../lib/api-client';
import { Button, Textarea } from '../../../components/ui';

export function MessageComposer({
  conversationId,
  peerName,
}: {
  conversationId: string;
  /** Имя собеседника — для текста результата. */
  peerName: string;
}): React.JSX.Element {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (body.trim() === '') {
      setError('Введите текст сообщения.');
      return;
    }
    setPending(true);

    try {
      await api.sendConversationMessage(conversationId, body.trim());
      setDone(`Отправлено. ${peerName} получит уведомление.`);
      setBody('');
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось отправить. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <form className="mt-3 space-y-3" onSubmit={handleSubmit} noValidate>
      <Textarea
        label="Сообщение"
        hint={`До ${MAX_MESSAGE_LENGTH} символов.`}
        value={body}
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={pending}
        onChange={(event) => setBody(event.target.value)}
      />

      <div role="status" aria-live="polite">
        {done === null ? null : (
          <p className="rounded-md bg-success-soft px-3 py-2 text-sm font-medium text-success">{done}</p>
        )}
      </div>
      <div role="alert">
        {error === null ? null : (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
        )}
      </div>

      <Button type="submit" loading={pending} loadingLabel="Отправляем…">
        Отправить
      </Button>
    </form>
  );
}

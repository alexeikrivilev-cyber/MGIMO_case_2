'use client';

/**
 * Решение сотрудника по верификации студбилета (клиентский остров).
 *
 * Два действия: одобрить (VERIFIED) или отклонить (REJECTED). Отказ
 * требует комментарий — студент должен понять, что не так с фото
 * (сервер проверяет то же правило: verificationReviewSchema).
 *
 * Отправка — POST /api/staff/verifications/[id]/decide через
 * lib/api-client (CSRF добавляется автоматически). После решения
 * студент получает уведомление, а список очереди обновляется.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api } from '../../../../lib/api-client';
import { Button, Card, Textarea } from '../../../../components/ui';

export function VerificationDecisionForm({
  verificationId,
  studentName,
  disabled = false,
}: {
  verificationId: string;
  studentName: string;
  /** Решение уже принято — форма не показывается. */
  disabled?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (disabled) {
    return (
      <p className="mt-3 text-xs text-text-muted">
        Решение принято: студент получил уведомление.
      </p>
    );
  }

  async function decide(status: 'VERIFIED' | 'REJECTED'): Promise<void> {
    setError(null);
    setDone(null);
    if (status === 'REJECTED' && comment.trim() === '') {
      setError('Для отказа укажите причину — студент увидит её в заявке.');
      return;
    }
    setPending(true);

    try {
      const result = await api.decideStaffVerification(verificationId, {
        status,
        comment: comment.trim() === '' ? undefined : comment.trim(),
      });
      setDone(
        status === 'VERIFIED'
          ? `Одобрено: ${studentName} получил(а) доступ к оценкам и переписке.`
          : `Отклонено. ${studentName} получил(а) причину.`,
      );
      setComment('');
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось сохранить решение. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await decide('REJECTED');
  }

  return (
    <Card className="mt-3">
      <h3 className="text-sm font-semibold text-text">Решение по верификации</h3>
      <p className="mt-1 text-xs text-text-muted">
        Одобрение открывает студенту успеваемость и переписку.
      </p>
      <form className="mt-3 space-y-3" onSubmit={handleSubmit} noValidate>
        <Textarea
          label="Комментарий"
          hint="Обязательно при отказе. До 1000 символов."
          value={comment}
          maxLength={1000}
          disabled={pending}
          onChange={(event) => setComment(event.target.value)}
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

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            loading={pending}
            loadingLabel="Сохраняем решение…"
            onClick={() => void decide('VERIFIED')}
          >
            Одобрить
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={pending}
            loadingLabel="Сохраняем решение…"
          >
            Отклонить
          </Button>
        </div>
      </form>
    </Card>
  );
}

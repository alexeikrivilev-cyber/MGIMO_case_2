'use client';

/**
 * Решение сотрудника по заявке (клиентский остров очереди заявок).
 *
 * Действие: новый статус + комментарий студенту. Отправка —
 * POST /api/staff/requests/[id]/decide через lib/api-client (CSRF-токен
 * добавляется клиентом автоматически). Сервер проверяет переход
 * (READY/REJECTED терминальны, REJECTED требует комментарий) и присылает
 * уведомление студенту — здесь только отправка и показ результата.
 *
 * Результат действия объявляется живой областью (aria-live="polite"):
 * скринридер зачитывает «статус изменён» без перевода фокуса.
 */
import { useState, type FormEvent } from 'react';
import { ApiClientError, api } from '../../../../lib/api-client';
import { Button, Card, Select, Textarea } from '../../../../components/ui';

/** Варианты статуса для сотрудника (IN_PROGRESS | READY | REJECTED). */
const STATUS_OPTIONS: readonly { value: 'IN_PROGRESS' | 'READY' | 'REJECTED'; label: string }[] = [
  { value: 'IN_PROGRESS', label: 'Взять в работу' },
  { value: 'READY', label: 'Готова — студент может получить' },
  { value: 'REJECTED', label: 'Отклонить (нужен комментарий)' },
];

export function RequestDecisionForm({
  requestId,
  requestTitle,
  currentStatus,
  onDone,
}: {
  requestId: string;
  requestTitle: string;
  currentStatus: string;
  /** Вызывается после успешного решения: страница обновит список. */
  onDone: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<'IN_PROGRESS' | 'READY' | 'REJECTED'>('IN_PROGRESS');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(null);
    // Та же проверка, что на сервере: отказ без причины студент не поймёт.
    if (status === 'REJECTED' && comment.trim() === '') {
      setError('Для отказа укажите причину — студент увидит её в заявке.');
      return;
    }
    setPending(true);

    try {
      const result = await api.decideStaffRequest(requestId, {
        status,
        staffComment: comment.trim() === '' ? undefined : comment.trim(),
      });
      setDone(`Статус изменён на «${result.request.statusLabel}». Студент получил уведомление.`);
      onDone();
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось сохранить решение. Проверьте соединение и попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <Card className="mt-3">
      <h3 className="text-sm font-semibold text-text">Решение по заявке «{requestTitle}»</h3>
      <p className="mt-1 text-xs text-text-muted">
        Текущий статус: {currentStatus}. Студент получит уведомление и увидит ваш комментарий в разделе «Заявки».
      </p>
      <form className="mt-3 space-y-3" onSubmit={handleSubmit} noValidate>
        <Select
          label="Новый статус"
          value={status}
          disabled={pending}
          onChange={(event) => setStatus(event.target.value as 'IN_PROGRESS' | 'READY' | 'REJECTED')}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Textarea
          label="Комментарий студенту"
          hint="Необязательно — кроме отказа: там причина обязательна. До 1000 символов."
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

        <Button type="submit" loading={pending} loadingLabel="Сохраняем решение…">
          Сохранить решение
        </Button>
      </form>
    </Card>
  );
}

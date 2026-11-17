'use client';

/**
 * Отмена своей заявки (клиентский остров). Доступна только в статусе
 * NEW: дальше заявку взял в работу сотрудник деканата (правило
 * packages/core, cancelMyRequest → 409 CONFLICT).
 *
 * Двухшаговое подтверждение inline — без window.confirm: первый тап
 * переводит кнопку в «Точно отменить?», второй выполняет отмену.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api } from '../../../lib/api-client';
import { Button } from '../../../components/ui';

export function CancelRequestButton({ requestId }: { requestId: string }): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.cancelRequest(requestId);
      router.refresh();
    } catch (cancelError) {
      setError(
        cancelError instanceof ApiClientError
          ? cancelError.message
          : 'Не удалось отменить заявку. Попробуйте снова.',
      );
      setPending(false);
      setConfirming(false);
    }
  }

  if (confirming === false) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)} disabled={pending}>
        Отменить заявку
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="danger" loading={pending} loadingLabel="Отменяем…" onClick={() => void cancel()}>
        Точно отменить?
      </Button>
      <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
        Нет, оставить
      </Button>
      {error === null ? null : (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

/**
 * Форма отметки «болею» (клиентский остров).
 *
 * Период (dateFrom/dateTo), причина и необязательное ФОТО справки.
 * Отправка — multipart на POST /api/sick-leave: фото справки уходит в
 * приватное хранилище packages/core (вне webroot, без публичных ссылок),
 * период и пересечения проверяет сервер. После отправки страница
 * перерисовывается на сервере с новой отметкой.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api, validateIdCardPhoto } from '../../../lib/api-client';
import { Button, Card, TextInput } from '../../../components/ui';

/** Дата в формате YYYY-MM-DD (как ждёт сервер). */
function dateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SickLeaveForm(): React.JSX.Element {
  const router = useRouter();
  const today = dateInputValue(new Date());
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [reason, setReason] = useState('');
  const [certificateName, setCertificateName] = useState<string | null>(null);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleCertificate(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    setCertificateError(null);
    if (file === undefined) {
      setCertificateName(null);
      return;
    }
    const problem = validateIdCardPhoto(file);
    if (problem !== null) {
      setCertificateError(problem);
      setCertificateName(null);
      event.target.value = '';
      return;
    }
    setCertificateName(file.name);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData();
    form.set('dateFrom', dateFrom);
    form.set('dateTo', dateTo);
    if (reason.trim() !== '') {
      form.set('reason', reason.trim());
    }
    const certificate = (event.currentTarget.elements.namedItem('certificate') as HTMLInputElement | null)
      ?.files?.[0];
    if (certificate !== undefined) {
      const problem = validateIdCardPhoto(certificate);
      if (problem !== null) {
        setCertificateError(problem);
        setPending(false);
        return;
      }
      form.set('certificate', certificate);
    }

    try {
      await api.createSickLeave(form);
      router.push('/sick-leave');
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось сохранить отметку. Проверьте соединение и попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text">Отметка «болею»</h2>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="С какого дня"
            type="date"
            value={dateFrom}
            disabled={pending}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <TextInput
            label="По какой день"
            type="date"
            value={dateTo}
            disabled={pending}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>
        <TextInput
          label="Причина"
          hint="Необязательно. Например: ОРВИ, температура. Причину видят сотрудники деканата."
          value={reason}
          maxLength={500}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
        />

        <div className="space-y-1.5">
          <label htmlFor="sick-certificate" className="block text-sm font-medium text-text">
            Фото справки (необязательно)
          </label>
          <p className="text-xs text-text-muted">
            Если справка есть — прикрепите снимок: JPEG, PNG или WebP, до 5 МБ. Файл хранится в
            приватном хранилище, по прямой ссылке его открыть нельзя.
          </p>
          <input
            id="sick-certificate"
            type="file"
            name="certificate"
            accept="image/jpeg,image/png,image/webp"
            disabled={pending}
            onChange={handleCertificate}
            aria-invalid={certificateError === null ? undefined : true}
            aria-describedby={certificateError === null ? undefined : 'sick-certificate-error'}
            className="block w-full min-h-11 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          {certificateName === null ? null : (
            <p className="text-xs text-text-muted">Выбран файл: {certificateName}</p>
          )}
          {certificateError === null ? null : (
            <p id="sick-certificate-error" className="text-xs text-danger">
              {certificateError}
            </p>
          )}
        </div>

        {/* Ошибка отправки — role=alert: живая область зачитывается
            скринридером сразу (WCAG 4.1.3). */}
        <div role="alert">
          {error === null ? null : (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
          )}
        </div>

        <Button type="submit" loading={pending} loadingLabel="Сохраняем…">
          Отметить болезнь
        </Button>
      </form>
    </Card>
  );
}

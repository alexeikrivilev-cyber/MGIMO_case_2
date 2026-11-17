'use client';

/**
 * Форма верификации студбилета (клиентский остров).
 *
 * Фото уходит ТОЛЬКО на POST /api/verification (multipart) — сервер
 * складывает его в приватное хранилище packages/core, вне webroot, без
 * публичных ссылок. Клиент проверяет формат и размер заработа
 * (validateIdCardPhoto в lib/api-client), чтобы не гонять лишние
 * мегабайты, но настоящая проверка — на сервере.
 */
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api, validateIdCardPhoto } from '../../../lib/api-client';
import { Button, Card, TextInput } from '../../../components/ui';

export function VerificationForm(): React.JSX.Element {
  const router = useRouter();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handlePhoto(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    setPhotoError(null);
    if (file === undefined) {
      setPhotoName(null);
      return;
    }
    const problem = validateIdCardPhoto(file);
    if (problem !== null) {
      setPhotoError(problem);
      setPhotoName(null);
      event.target.value = '';
      return;
    }
    setPhotoName(file.name);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const file = fileInputRef.current?.files?.[0];
    if (file === undefined) {
      setPhotoError('Прикрепите фото студенческого билета.');
      return;
    }
    const problem = validateIdCardPhoto(file);
    if (problem !== null) {
      setPhotoError(problem);
      return;
    }

    setPending(true);
    try {
      await api.submitVerification(cardNumber, file);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось отправить заявку. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text">Заявка на верификацию</h2>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Номер студенческого билета"
          hint="С самой карточки. Например, ПИ-2023-0138."
          value={cardNumber}
          disabled={pending}
          onChange={(event) => setCardNumber(event.target.value)}
          error={null}
        />

        <div className="space-y-1.5">
          <label htmlFor={fileInputId} className="block text-sm font-medium text-text">
            Фото студенческого билета
          </label>
          <p className="text-xs text-text-muted">
            Снимок карточки: JPEG, PNG или WebP, до 5 МБ. Хранится в приватном хранилище.
          </p>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            disabled={pending}
            onChange={handlePhoto}
            aria-invalid={photoError === null ? undefined : true}
            aria-describedby={photoError === null ? undefined : `${fileInputId}-error`}
            className="block w-full min-h-11 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          {photoName === null ? null : <p className="text-xs text-text-muted">Выбран файл: {photoName}</p>}
          {photoError === null ? null : (
            <p id={`${fileInputId}-error`} className="text-xs text-danger">
              {photoError}
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

        <Button
          type="submit"
          loading={pending}
          loadingLabel="Отправляем…"
          disabled={cardNumber.trim().length < 4}
        >
          Отправить на проверку
        </Button>
      </form>
    </Card>
  );
}

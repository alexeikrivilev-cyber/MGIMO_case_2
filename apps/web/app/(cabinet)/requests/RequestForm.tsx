'use client';

/**
 * Форма новой заявки (клиентский остров).
 *
 * Тип заявки: справка или заявление (REQUEST_TYPE_LABELS в packages/core).
 * Для справки — цель, способ получения и семестр; для заявления — тема и
 * текст. Отправка идёт на POST /api/requests через lib/api-client
 * (CSRF-заголовок клиент добавляет сам); сервер создаёт заявку со
 * статусом NEW и присылает уведомление.
 *
 * После успеха остров уводит на /requests (без query) — страница
 * перерисовывается на сервере уже с новой заявкой: состояние формы
 * живёт в адресе, а не в клиентском стейте.
 */
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiClientError, api } from '../../../lib/api-client';
import { Button, Card, Select, TextInput, Textarea } from '../../../components/ui';
import { SEMESTER_OPTIONS } from '../../../components/labels';

type RequestType = 'REFERENCE' | 'APPLICATION';

/** Способы получения справки. */
const DELIVERY_OPTIONS: readonly string[] = [
  'На бумажном носителе в деканате',
  'Электронной копией на университетскую почту',
];

export function RequestForm(): React.JSX.Element {
  const router = useRouter();
  const [type, setType] = useState<RequestType>('REFERENCE');
  const [purpose, setPurpose] = useState('');
  const [delivery, setDelivery] = useState<string>(DELIVERY_OPTIONS[0] ?? '');
  const [semester, setSemester] = useState<string>('2');
  const [topic, setTopic] = useState('');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referenceValid = purpose.trim() !== '' && delivery.trim() !== '' && semester.trim() !== '';
  const applicationValid = topic.trim() !== '' && body.trim().length >= 10;
  const valid = type === 'REFERENCE' ? referenceValid : applicationValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const formData: Record<string, string> =
        type === 'REFERENCE'
          ? { purpose: purpose.trim(), delivery: delivery.trim(), semester: semester.trim() }
          : { topic: topic.trim(), body: body.trim() };
      await api.createRequest({ type, formData });
      router.push('/requests');
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось отправить заявку. Проверьте соединение и попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text">Новая заявка</h2>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <Select
          label="Тип заявки"
          value={type}
          onChange={(event) => setType(event.target.value as RequestType)}
          disabled={pending}
        >
          <option value="REFERENCE">Справка</option>
          <option value="APPLICATION">Заявление</option>
        </Select>

        {type === 'REFERENCE' ? (
          <>
            <TextInput
              label="Цель справки"
              hint="Например: по месту требования, в банк, для оформления скидки на проезд."
              value={purpose}
              disabled={pending}
              onChange={(event) => setPurpose(event.target.value)}
            />
            <Select
              label="Способ получения"
              value={delivery}
              onChange={(event) => setDelivery(event.target.value)}
              disabled={pending}
            >
              {DELIVERY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Select
              label="Семестр"
              hint="За какой семестр нужна справка об обучении."
              value={semester}
              onChange={(event) => setSemester(event.target.value)}
              disabled={pending}
            >
              {SEMESTER_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {option} семестр
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <TextInput
              label="Тема заявления"
              hint="Кратко: что вы просите. Например: академический отпуск, материальная помощь."
              value={topic}
              disabled={pending}
              onChange={(event) => setTopic(event.target.value)}
            />
            <Textarea
              label="Текст заявления"
              hint="Опишите просьбу подробно: сотрудник деканата видит этот текст."
              value={body}
              disabled={pending}
              onChange={(event) => setBody(event.target.value)}
            />
          </>
        )}

        {/* Ошибка отправки — role=alert: живая область зачитывается
            скринридером сразу (WCAG 4.1.3), текст опасным токеном. */}
        <div role="alert">
          {error === null ? null : (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending} loadingLabel="Отправляем…" disabled={!valid}>
            Отправить заявку
          </Button>
          <Link href="/requests">
            <Button variant="secondary" disabled={pending}>
              Отмена
            </Button>
          </Link>
        </div>
      </form>
    </Card>
  );
}

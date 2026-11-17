'use client';

/**
 * Изменение пары в кабинете сотрудника (клиентский остров): перенос на
 * новую дату (и, опционально, в новую аудиторию) либо отмена с причиной.
 *
 * Отправка — POST /api/staff/schedule/[id]/move или .../cancel через
 * lib/api-client (CSRF добавляется автоматически). Сервер проверяет
 * faculty-scope (чужой факультет → 404), допустимость перехода
 * (отменённую пару не отменить повторно) и рассылает уведомления
 * студентам группы; здесь — форма и показ результата.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api } from '../../../../lib/api-client';
import { Button, Card, Select, TextInput, Textarea } from '../../../../components/ui';

export function LessonChangeForm({
  lessonId,
  date,
  room,
  subjectName,
  groupName,
}: {
  lessonId: string;
  /** Дата пары (YYYY-MM-DD). */
  date: string;
  room: string;
  subjectName: string;
  groupName: string;
}): React.JSX.Element {
  const router = useRouter();
  const [action, setAction] = useState<'move' | 'cancel'>('move');
  const [newDate, setNewDate] = useState(date);
  const [newRoom, setNewRoom] = useState(room);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(null);

    if (action === 'cancel' && reason.trim() === '') {
      setError('Укажите причину отмены — её увидят студенты.');
      return;
    }
    if (action === 'move' && !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError('Укажите новую дату в формате ГГГГ-ММ-ДД.');
      return;
    }
    setPending(true);

    try {
      if (action === 'move') {
        const result = await api.moveStaffLesson(lessonId, {
          date: newDate,
          room: newRoom.trim() === '' ? undefined : newRoom.trim(),
          note: note.trim() === '' ? undefined : note.trim(),
        });
        setDone(
          `Пара перенесена на ${newDate}${result.lesson.movedToRoom === null ? '' : `, аудитория ${result.lesson.movedToRoom}`}. Студенты группы ${groupName} получили уведомление.`,
        );
      } else {
        await api.cancelStaffLesson(lessonId, reason.trim());
        setDone(`Пара отменена. Студенты группы ${groupName} получили уведомление с причиной.`);
      }
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось сохранить изменение. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <Card className="mt-3">
      <h3 className="text-sm font-semibold text-text">
        Изменить пару: {subjectName} ({groupName})
      </h3>
      <form className="mt-3 space-y-3" onSubmit={handleSubmit} noValidate>
        <Select
          label="Действие"
          value={action}
          disabled={pending}
          onChange={(event) => setAction(event.target.value as 'move' | 'cancel')}
        >
          <option value="move">Перенести на другую дату</option>
          <option value="cancel">Отменить пару</option>
        </Select>

        {action === 'move' ? (
          <>
            <TextInput
              label="Новая дата"
              type="date"
              hint="Исходный слот останется с отметкой «перенесена»."
              value={newDate}
              disabled={pending}
              onChange={(event) => setNewDate(event.target.value)}
            />
            <TextInput
              label="Новая аудитория"
              hint="Если пусто — аудитория прежняя."
              value={newRoom}
              maxLength={50}
              disabled={pending}
              onChange={(event) => setNewRoom(event.target.value)}
            />
            <Textarea
              label="Примечание"
              hint="Например: «перенос согласован с кафедрой»."
              value={note}
              maxLength={500}
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        ) : (
          <Textarea
            label="Причина отмены"
            hint="Обязательно. Причину увидят студенты."
            value={reason}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
          />
        )}

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

        <Button type="submit" loading={pending} loadingLabel="Сохраняем…">
          {action === 'move' ? 'Перенести пару' : 'Отменить пару'}
        </Button>
      </form>
    </Card>
  );
}

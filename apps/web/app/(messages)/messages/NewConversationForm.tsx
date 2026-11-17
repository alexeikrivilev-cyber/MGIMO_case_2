'use client';

/**
 * «Написать преподавателю» (клиентский остров переписки студента).
 *
 * Выбор преподавателя из справочника (/api/teachers — тот же список, что
 * на экране «Преподаватели») и создание диалога: POST /api/conversations.
 * Диалог с тем же преподавателем не дублируется — сервер открывает
 * существующий (пара «студент + преподаватель» уникальна), поэтому
 * повторное нажатие не теряет историю переписки.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api } from '../../../lib/api-client';
import { Button, Select } from '../../../components/ui';
import type { TeacherListItem } from '@udgu/core';

export function NewConversationForm({ teachers }: { teachers: readonly TeacherListItem[] }): React.JSX.Element {
  const router = useRouter();
  const [teacherId, setTeacherId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (teacherId === '') {
      setError('Выберите преподавателя.');
      return;
    }
    setPending(true);

    try {
      const result = await api.createConversation(teacherId);
      router.push(`/messages?conversation=${encodeURIComponent(result.conversation.id)}`);
    } catch (submitError) {
      setError(
        submitError instanceof ApiClientError
          ? submitError.message
          : 'Не удалось открыть диалог. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={handleSubmit} noValidate>
      <div className="min-w-0 flex-1">
        <Select
          label="Написать преподавателю"
          value={teacherId}
          disabled={pending || teachers.length === 0}
          onChange={(event) => setTeacherId(event.target.value)}
        >
          <option value="">
            {teachers.length === 0 ? 'Преподаватели не найдены' : 'Выберите преподавателя'}
          </option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.fullName} — {teacher.department}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" loading={pending} loadingLabel="Открываем диалог…">
        Написать
      </Button>
      <div role="alert" className="w-full">
        {error === null ? null : (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
        )}
      </div>
    </form>
  );
}

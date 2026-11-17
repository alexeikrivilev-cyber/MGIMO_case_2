'use client';

/**
 * Публикация объявления деканата (клиентский остров).
 *
 * Аудитория: весь университет / институт / группа. Институт берётся из
 * сессии на СЕРВЕРЕ — форма не отправляет faculty сотрудника (подменить
 * его нельзя), а для ADMIN показывает поле института: у него faculty нет,
 * и указать его должен он сам (services/staffAnnouncements.ts).
 *
 * Отправка — POST /api/staff/announcements через lib/api-client
 * (CSRF-токен добавляется автоматически). Сервер рассылает уведомления
 * студентам аудитории и пишет аудит; здесь — форма и показ результата.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, api } from '../../../../lib/api-client';
import { Button, Card, Select, Textarea, TextInput } from '../../../../components/ui';

/** Аудитории объявления: подписи как в справочнике студентов. */
const AUDIENCES: readonly { value: 'ALL' | 'FACULTY' | 'GROUP'; label: string; hint: string }[] = [
  { value: 'ALL', label: 'Весь университет', hint: 'Все студенты всех институтов.' },
  { value: 'FACULTY', label: 'Институт', hint: 'Студенты вашего института.' },
  { value: 'GROUP', label: 'Группа', hint: 'Одна группа вашего института.' },
];

export function AnnouncementForm({
  groups,
  faculty,
  allFaculties,
}: {
  /** Группы института сотрудника — для аудитории «Группа». */
  groups: readonly { id: string; name: string }[];
  /** Институт сотрудника; null у ADMIN. */
  faculty: string | null;
  /** ADMIN публикует и «весь университет», и в любой институт. */
  allFaculties: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'ALL' | 'FACULTY' | 'GROUP'>('FACULTY');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [adminFaculty, setAdminFaculty] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const audienceHint = AUDIENCES.find((item) => item.value === audience)?.hint ?? '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(null);

    // Та же проверка, что на сервере (staffAnnouncementSchema): пустые
    // поля не отправляем — студент увидит понятную ошибку здесь же.
    if (title.trim() === '') {
      setError('Укажите заголовок объявления.');
      return;
    }
    if (body.trim() === '') {
      setError('Укажите текст объявления.');
      return;
    }
    if (audience === 'GROUP' && groupId === '') {
      setError('Выберите группу для объявления.');
      return;
    }
    if (allFaculties && audience === 'FACULTY' && adminFaculty.trim() === '') {
      setError('Укажите институт.');
      return;
    }
    setPending(true);

    try {
      const result = await api.createStaffAnnouncement({
        title: title.trim(),
        body: body.trim(),
        audience,
        pinned,
        ...(audience === 'GROUP' ? { groupId } : {}),
        ...(allFaculties && audience === 'FACULTY' ? { faculty: adminFaculty.trim() } : {}),
      });
      const scope =
        result.announcement.audience === 'GROUP' && result.announcement.groupName !== null
          ? `группа ${result.announcement.groupName}`
          : result.announcement.audience === 'ALL'
            ? 'весь университет'
            : (result.announcement.faculty ?? 'институт');
      setDone(`Объявление опубликовано: ${scope}. Студенты получили уведомление.`);
      setTitle('');
      setBody('');
      setPinned(false);
      router.refresh();
    } catch (submitError) {
      const details =
        submitError instanceof ApiClientError && submitError.details.length > 0
          ? ` ${submitError.details.join(' ')}`
          : '';
      setError(
        submitError instanceof ApiClientError
          ? `${submitError.message}${details}`
          : 'Не удалось опубликовать. Попробуйте снова.',
      );
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text">Новое объявление</h2>
      <p className="mt-1 text-sm text-text-muted">
        Студенты аудитории получат уведомление.
      </p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Заголовок"
          hint="До 200 символов."
          value={title}
          maxLength={200}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          label="Текст объявления"
          hint="До 4000 символов."
          value={body}
          maxLength={4000}
          disabled={pending}
          onChange={(event) => setBody(event.target.value)}
        />

        <Select
          label="Аудитория"
          hint={audienceHint}
          value={audience}
          disabled={pending}
          onChange={(event) => setAudience(event.target.value as 'ALL' | 'FACULTY' | 'GROUP')}
        >
          {AUDIENCES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>

        {audience === 'GROUP' ? (
          <Select
            label="Группа"
            hint="Только группы вашего института."
            value={groupId}
            disabled={pending || groups.length === 0}
            onChange={(event) => setGroupId(event.target.value)}
          >
            {groups.length === 0 ? <option value="">Групп института не найдено</option> : null}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        ) : null}

        {allFaculties && audience === 'FACULTY' ? (
          <TextInput
            label="Институт"
            hint="Укажите институт."
            value={adminFaculty}
            maxLength={200}
            disabled={pending}
            onChange={(event) => setAdminFaculty(event.target.value)}
          />
        ) : null}

        {audience === 'FACULTY' && !allFaculties ? (
          <p className="text-xs text-text-muted">Аудитория — ваш институт: {faculty ?? 'не указан'}.</p>
        ) : null}

        <div className="flex items-start gap-2">
          <input
            id="announcement-pinned"
            type="checkbox"
            checked={pinned}
            disabled={pending}
            onChange={(event) => setPinned(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-border bg-surface-2 text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <label htmlFor="announcement-pinned" className="text-sm text-text">
            Закрепить сверху
            <span className="block text-xs text-text-muted">
              Будет первым в списке.
            </span>
          </label>
        </div>

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

        <Button type="submit" loading={pending} loadingLabel="Публикуем…">
          Опубликовать
        </Button>
      </form>
    </Card>
  );
}

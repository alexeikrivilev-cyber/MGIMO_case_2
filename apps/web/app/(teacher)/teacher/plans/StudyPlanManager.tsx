'use client';

/**
 * Панель учебных планов преподавателя (клиентский остров).
 *
 * Загрузка уходит на POST /api/teacher/study-plans (multipart) через
 * lib/api-client: заголовок X-CSRF-Token клиент добавляет сам,
 * авторизация — только httpOnly-cookie сессии. Удаление —
 * DELETE /api/teacher/study-plans/[id]: чужой план сервер не удалит
 * (404), но кнопки здесь только для своих планов из списка сессии.
 *
 * Формат и размер проверяются на клиенте (validateStudyPlanFile), чтобы
 * не гонять лишние мегабайты, но настоящая проверка — на сервере.
 * После успешного действия список обновляется router.refresh():
 * данные снова приходят из packages/core, клиент их не дублирует.
 */
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import styles from '../../../workspace.module.css';
import { useRouter } from 'next/navigation';
import { ApiClientError, api, validateStudyPlanFile } from '../../../../lib/api-client';
import { Button, Card, EmptyState, TextInput } from '../../../../components/ui';
import { formatFileSize, formatMoment } from '../../../../components/format';
import { IconRequests } from '../../../../components/icons';
import type { StudyPlanListItem } from '@udgu/core';

/** Форма плана: заголовок + файл + одна строка пояснения. */
function StudyPlanForm({
  pending,
  onUpload,
}: {
  pending: boolean;
  onUpload: (title: string, file: File) => void;
}): React.JSX.Element {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    setFileError(null);
    if (file === undefined) {
      setFileName(null);
      return;
    }
    const problem = validateStudyPlanFile(file);
    if (problem !== null) {
      setFileError(problem);
      setFileName(null);
      event.target.value = '';
      return;
    }
    setFileName(file.name);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (file === undefined) {
      setFileError('Прикрепите файл плана.');
      return;
    }
    const problem = validateStudyPlanFile(file);
    if (problem !== null) {
      setFileError(problem);
      return;
    }
    onUpload(title, file);
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text">Загрузить план</h2>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Название плана"
          placeholder="Основы программирования"
          value={title}
          maxLength={120}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />

        <div className="space-y-1.5">
          <label htmlFor={fileInputId} className="block text-sm font-medium text-text">
            Файл плана
          </label>
          <p className="text-xs text-text-muted">
            Markdown или текст · до 1 МБ
          </p>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".md,.txt,text/markdown,text/plain"
            disabled={pending}
            onChange={handleFile}
            aria-invalid={fileError === null ? undefined : true}
            aria-describedby={fileError === null ? undefined : `${fileInputId}-error`}
            className="block w-full min-h-11 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          {fileName === null ? null : <p className="text-xs text-text-muted">Выбран файл: {fileName}</p>}
          {fileError === null ? null : (
            <p id={`${fileInputId}-error`} className="text-xs text-danger">
              {fileError}
            </p>
          )}
        </div>

        <Button type="submit" loading={pending} loadingLabel="Загружаем…" disabled={title.trim() === ''}>
          Загрузить план
        </Button>
      </form>
    </Card>
  );
}

/** План в списке: название, дата, размер и удаление (с подтверждением). */
function StudyPlanRow({
  plan,
  deleting,
  onDelete,
}: {
  plan: StudyPlanListItem;
  deleting: boolean;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className={styles.fileRow}>
        <div className={styles.person}>
          <span className={styles.initials} aria-hidden="true"><IconRequests /></span>
          <div className={styles.fileInfo}>
            <p className="text-sm font-semibold text-text">{plan.title}</p>
            <p className={styles.recordMeta}>
              {formatMoment(new Date(plan.uploadedAt))} · {formatFileSize(plan.sizeBytes)}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {confirming ? (
            <>
              <Button variant="danger" loading={deleting} loadingLabel="Удаляем…" onClick={() => onDelete(plan.id)}>
                Точно удалить
              </Button>
              <Button variant="secondary" disabled={deleting} onClick={() => setConfirming(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Удалить
            </Button>
          )}
        </div>
    </li>
  );
}

export function StudyPlanManager({ plans }: { plans: readonly StudyPlanListItem[] }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState('');
  const [formVersion, setFormVersion] = useState(0);

  async function upload(title: string, file: File): Promise<void> {
    setPending(true);
    setError(null);
    setNotice('');
    try {
      await api.uploadTeacherStudyPlan(title, file);
      setNotice('План загружен.');
      setFormVersion((version) => version + 1);
      router.refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiClientError
          ? uploadError.message
          : 'Не удалось загрузить план. Попробуйте снова.',
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setDeletingId(id);
    setError(null);
    setNotice('');
    try {
      await api.deleteTeacherStudyPlan(id);
      setNotice('План удалён.');
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof ApiClientError
          ? deleteError.message
          : 'Не удалось удалить план. Попробуйте снова.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? <p role="status" className="rounded-md bg-success-soft p-3 text-sm text-success">{notice}</p> : null}

      {/* Ошибка действия — role=alert: живая область зачитывается скринридером. */}
      <div role="alert">
        {error === null ? null : (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
        )}
      </div>

      <div className={styles.library}>
      <section aria-labelledby="plans-list" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="plans-list" className="mb-2 text-base font-semibold text-text">
          Загруженные планы <span className="text-text-muted">· {plans.length}</span>
        </h2>
        {plans.length === 0 ? (
          <EmptyState
            title="Планов пока нет"
            description="Загрузите учебный план — ассистент начнёт отвечать по его разделам."
            icon={<IconRequests />}
          />
        ) : (
          <ul className="space-y-2">
            {plans.map((plan) => (
              <StudyPlanRow
                key={plan.id}
                plan={plan}
                deleting={deletingId === plan.id}
                onDelete={(id) => void remove(id)}
              />
            ))}
          </ul>
        )}
      </section>
      <StudyPlanForm key={formVersion} pending={pending} onUpload={(title, file) => void upload(title, file)} />
      </div>
    </div>
  );
}

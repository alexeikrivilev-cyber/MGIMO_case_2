'use client';

/**
 * Фото студенческого билета из ПРИВАТНОГО хранилища.
 *
 * Единственный допустимый источник изображения — авторизованный роут
 * /api/staff/verifications/[id]/photo: он проверяет сессию и
 * faculty-scope, отдаёт буфер с Content-Type по расширению файла и
 * Cache-Control: no-store. Прямой ссылки на storage в интерфейсе нет и
 * быть не может: файл лежит вне webroot, а путь из БД клиенту не
 * отдаётся никогда (services/staffVerifications.ts).
 *
 * Если фото не загрузилось (файл не найден в хранилище, сетевой сбой) —
 * показываем объяснение и кнопку «Повторить», а не сломанный <img>.
 */
import { useState } from 'react';
import { Button } from '../../../../components/ui';

export function VerificationPhoto({
  verificationId,
  studentName,
}: {
  verificationId: string;
  studentName: string;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = `/api/staff/verifications/${encodeURIComponent(verificationId)}/photo${
    attempt === 0 ? '' : `?retry=${attempt}`
  }`;

  if (failed) {
    return (
      <div className="mt-3" data-testid="verification-photo-error">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          Фото студбилета не загрузилось. Файл мог быть заменён повторной заявкой — откройте очередь заново или
          повторите попытку.
        </p>
        <div className="mt-2">
          <Button
            variant="secondary"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Повторить загрузку фото
          </Button>
        </div>
      </div>
    );
  }

  return (
    <figure className="mt-3">
      <img
        src={src}
        alt={`Фото студенческого билета: ${studentName}`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block w-full max-w-xs rounded-md border border-border bg-surface-2 object-cover"
      />
      <figcaption className="mt-1.5 text-xs text-text-muted">
        Фото отдаётся только авторизованным маршрутом кабинета — прямой ссылки на хранилище нет.
      </figcaption>
    </figure>
  );
}

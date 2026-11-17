'use client';

/**
 * Кнопка выхода (клиентский остров).
 *
 * POST /api/auth/logout отзывает сессию на сервере и чистит cookie.
 * Выход идемпотентен: даже если запрос не дошёл (сеть), браузер всё
 * равно уводится на /login, где сессия проверяется заново. Поэтому
 * редирект выполняется в любом случае, а ошибку запроса не показываем
 * отдельным экраном — цель достигнута.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api-client';
import { Button, type ButtonProps } from './ui';

export function LogoutButton({
  label = 'Выйти',
  variant = 'secondary',
  fullWidth = false,
}: {
  label?: string;
  variant?: ButtonProps['variant'];
  fullWidth?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout(): Promise<void> {
    setPending(true);
    try {
      await api.logout();
    } catch {
      // См. комментарий файла: редирект всё равно выполняется.
    } finally {
      router.push('/login');
    }
  }

  return (
    <Button variant={variant} fullWidth={fullWidth} loading={pending} loadingLabel="Выходим…" onClick={() => void logout()}>
      {label}
    </Button>
  );
}

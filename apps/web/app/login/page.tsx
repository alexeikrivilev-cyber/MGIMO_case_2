'use client';

import { useState, type FormEvent } from 'react';

interface LoginResponse {
  error?: string;
  redirectTo?: string;
}

export default function LoginPage(): React.JSX.Element {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });

      const payload = (await response.json().catch(() => null)) as LoginResponse | null;

      if (!response.ok) {
        setError(payload?.error ?? `Сервер вернул ошибку ${response.status}. Попробуйте позже.`);
        return;
      }

      // Сервер отвечает целью редиректа по роли: студент — в кабинет,
      // сотрудник деканата — в /staff.
      window.location.assign(payload?.redirectTo ?? '/dashboard');
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-md">
        <h1 className="text-2xl font-semibold tracking-tight">Вход в кабинет</h1>
        <p className="mt-1 text-sm text-text-muted">
          УдГУ — цифровой деканат
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium" htmlFor="login">
              Логин
            </label>
            <input
              id="login"
              name="login"
              type="text"
              autoComplete="username"
              required
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              aria-invalid={error !== null}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error !== null}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div aria-live="polite" role="status">
            {error !== null && (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="login-error">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending || login.length === 0 || password.length === 0}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <div className="mt-6 rounded-md bg-surface-2 p-3 text-xs text-text-muted">
          <p className="font-medium text-text">Демо-доступы (вымышленные данные):</p>
          <p className="mt-1">student1 … student4, staff1, admin1</p>
          <p>пароль: password123</p>
        </div>
      </div>
    </main>
  );
}

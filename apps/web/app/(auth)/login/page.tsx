'use client';

/**
 * Страница входа (route group (auth)).
 *
 * Сценарии (ACCEPTANCE):
 * - вход по логину/паролю университетской учётной записи → POST
 *   /api/auth/login; ошибка сервера показывается в живой области
 *   (aria-live), редирект — на redirectTo из ответа (роль решает, куда:
 *   студент — в кабинет, сотрудник — в кабинет деканата);
 * - регистрация/вход через VK ID / MAX / Telegram → POST
 *   /api/auth/oauth/{provider}/start → переход на consentUrl
 *   (/register?state=…&provider=… — страница-эмуляция согласия);
 * - rate-limit (429) — текст с количеством минут из заголовка
 *   Retry-After: «Слишком много попыток, попробуйте через N минут»;
 * - неверный пароль даёт ОДНУ обобщённую ошибку «Неверный логин или
 *   пароль» (сервер не различает «нет такого логина» и «неверный пароль»).
 *
 * Демо-доступы вымышленные: пароль одинаковый, данные синтетические.
 */
import { useState, type FormEvent } from 'react';
import { ApiClientError, api, type OAuthProviderPath } from '../../../lib/api-client';
import { Button, Card, TextInput } from '../../../components/ui';
import { ConceptMark } from '../../../components/ConceptMark';

/** Провайдеры OAuth-эмуляции: сегмент пути роута → подпись кнопки. */
const OAUTH_PROVIDERS: readonly { readonly path: OAuthProviderPath; readonly label: string }[] = [
  { path: 'vk_id', label: 'VK ID' },
  { path: 'max', label: 'MAX' },
  { path: 'telegram', label: 'Telegram' },
];

/** Демо-аккаунты прототипа (вымышленные данные, пароль общий). */
const DEMO_ACCOUNTS: readonly string[] = [
  'student1 … student4 — студенты',
  'teacher1 … teacher3 — преподаватели',
  'staff1 — сотрудник деканата',
  'admin1 — администратор',
];

const NETWORK_ERROR = 'Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.';

/** Идентификатор текста ошибки: поля формы ссылаются на него через aria-describedby. */
const LOGIN_ERROR_ID = 'login-form-error';

/** Текст ошибки входа: для 429 — минуты ожидания из заголовка Retry-After. */
function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 429) {
      const minutes =
        error.retryAfterSeconds === null ? null : Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
      return minutes === null
        ? 'Слишком много попыток входа. Попробуйте позже.'
        : `Слишком много попыток, попробуйте через ${minutes} ${pluralMinutes(minutes)}.`;
    }
    return error.message;
  }
  return NETWORK_ERROR;
}

/** Русская форма слова «минута»: 1 минута / 2 минуты / 5 минут. */
function pluralMinutes(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'минуту';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'минуты';
  return 'минут';
}

export default function LoginPage(): React.JSX.Element {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<OAuthProviderPath | null>(null);

  const busy = pending || oauthPending !== null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await api.login({ login, password });
      window.location.assign(result.redirectTo);
    } catch (loginError) {
      setError(loginErrorMessage(loginError));
      setPending(false);
    }
  }

  async function handleOAuth(provider: OAuthProviderPath): Promise<void> {
    setError(null);
    setOauthPending(provider);
    try {
      // consentUrl → /register?state=…&provider=… — страница-эмуляция согласия.
      const { consentUrl } = await api.startOAuth(provider);
      window.location.assign(consentUrl);
    } catch (oauthError) {
      setError(oauthError instanceof ApiClientError ? oauthError.message : NETWORK_ERROR);
      setOauthPending(null);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <ConceptMark className="h-10 w-10 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Вход в кабинет</h1>
          <p className="mt-0.5 text-sm text-text-muted">УдГУ — цифровой деканат</p>
        </div>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Логин"
          name="login"
          type="text"
          autoComplete="username"
          required
          value={login}
          disabled={busy}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : LOGIN_ERROR_ID}
          onChange={(event) => setLogin(event.target.value)}
        />
        <TextInput
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={busy}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : LOGIN_ERROR_ID}
          onChange={(event) => setPassword(event.target.value)}
        />

        {/* Ошибка входа — живая область role=alert (WCAG 4.1.3): скринридер
            зачитывает сообщение сразу, без перехода к другому блоку. Через
            aria-describedby ошибка связана с обоими полями формы. */}
        <div role="alert">
          {error === null ? null : (
            <p
              className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
              id={LOGIN_ERROR_ID}
              data-testid="login-error"
            >
              {error}
            </p>
          )}
        </div>

        <Button
          type="submit"
          fullWidth
          loading={pending}
          loadingLabel="Входим…"
          disabled={busy || login.trim() === '' || password === ''}
        >
          Войти
        </Button>
      </form>

      <div className="mt-6 space-y-2">
        <p className="text-xs font-medium text-text-muted">Или через провайдера (эмуляция согласия)</p>
        {OAUTH_PROVIDERS.map((provider) => (
          <Button
            key={provider.path}
            variant="secondary"
            fullWidth
            loading={oauthPending === provider.path}
            loadingLabel="Открываем согласие…"
            disabled={busy}
            onClick={() => handleOAuth(provider.path)}
          >
            {`Войти через ${provider.label}`}
          </Button>
        ))}
      </div>

      <div className="mt-6 rounded-md bg-surface-2 p-3 text-xs text-text-muted">
        <p className="font-medium text-text">Демо-доступы (вымышленные данные)</p>
        <ul className="mt-1 space-y-0.5">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account}>{account}</li>
          ))}
        </ul>
        <p className="mt-1.5">Пароль для всех: password123</p>
        <p className="mt-1.5">Все данные в прототипе синтетические, реальных персональных данных нет.</p>
      </div>
    </Card>
  );
}

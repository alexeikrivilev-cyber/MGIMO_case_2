'use client';

/**
 * Страница-эмуляция согласия провайдера (route group (auth)):
 * /register?state=…&provider=… — продолжение сценария «Войти через
 * VK ID / MAX / Telegram» со страницы входа.
 *
 * Контракт (BRIEF v2): ФИО и группа обязательны — без них студента
 * нельзя посадить в группу и показать расписание. Логин НЕ обязателен:
 * студент вошёл через провайдера, а не придумывал логин; если он пуст,
 * сервер выводит логин из идентификатора аккаунта провайдера (схема
 * oauthCallbackSchema, lib/validation.ts).
 *
 * Провайдер приходит из ссылки согласия (start отдаёт
 * /register?state=…&provider=…) — пользователь видит того же
 * провайдера, через которого нажал «Войти».
 *
 * Ошибки: 400 (неизвестная группа, битая/использованная ссылка) —
 * сообщение и «Начать заново»; 409 (логин занят) — ошибка у поля
 * логина, форма остаётся редактируемой.
 */
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ApiClientError, api, type OAuthProviderPath } from '../../../lib/api-client';
import { Button, Card, ErrorState, Skeleton, TextInput } from '../../../components/ui';

const OAUTH_PROVIDER_LABELS: Readonly<Record<OAuthProviderPath, string>> = {
  vk_id: 'VK ID',
  max: 'MAX',
  telegram: 'Telegram',
};

const NETWORK_ERROR = 'Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.';

/** Минимальная длина state — как в oauthCallbackSchema (битая ссылка отсевается сразу). */
const MIN_STATE_LENGTH = 8;

function isProvider(value: string | null): value is OAuthProviderPath {
  return value === 'vk_id' || value === 'max' || value === 'telegram';
}

function RegisterForm(): React.JSX.Element {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const providerParam = searchParams.get('provider');
  const provider: OAuthProviderPath = isProvider(providerParam) ? providerParam : 'vk_id';

  const [fullName, setFullName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [login, setLogin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  /** Ссылка согласия непригодна: показываем сообщение и «Начать заново». */
  const [linkBroken, setLinkBroken] = useState<string | null>(
    state === null || state.length < MIN_STATE_LENGTH
      ? 'Ссылка регистрации недействительна или устарела. Начните регистрацию заново.'
      : null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoginError(null);
    setPending(true);
    try {
      const result = await api.oauthCallback(provider, {
        state: state ?? '',
        fullName,
        groupName,
        login,
      });
      window.location.assign(result.redirectTo);
    } catch (submitError) {
      if (submitError instanceof ApiClientError && submitError.status === 409) {
        // Логин занят: форма остаётся, пользователь меняет логин.
        setLoginError(submitError.message);
      } else if (submitError instanceof ApiClientError && submitError.status === 400) {
        // Неизвестная группа или использованная ссылка: начинать надо заново.
        setLinkBroken(submitError.message);
      } else {
        setError(submitError instanceof ApiClientError ? submitError.message : NETWORK_ERROR);
      }
      setPending(false);
    }
  }

  if (linkBroken !== null) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Регистрация</h1>
        <div className="mt-4">
          <ErrorState message={linkBroken} onRetry={() => window.location.assign('/login')} retryLabel="Начать заново" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-semibold tracking-tight text-text">Регистрация</h1>
      <p className="mt-1 text-sm text-text-muted">
        {`Вы входите через ${OAUTH_PROVIDER_LABELS[provider]} (эмуляция согласия, реальных ключей нет)`}
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="ФИО"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          disabled={pending}
          hint="Как в студенческом: фамилия, имя и отчество."
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />

        <TextInput
          label="Группа"
          name="groupName"
          type="text"
          required
          disabled={pending}
          hint="Название группы показывает староста в расписании группы (например, ПИ-31)."
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
        />

        <TextInput
          label="Логин учётной записи университета"
          name="login"
          type="text"
          autoComplete="username"
          disabled={pending}
          hint="Можно не указывать: вход выполнен через провайдера. Если оставить пустым, логин создастся автоматически."
          error={loginError}
          value={login}
          onChange={(event) => setLogin(event.target.value)}
        />

        <div aria-live="polite" role="status">
          {error === null ? null : (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
          )}
        </div>

        <Button
          type="submit"
          fullWidth
          loading={pending}
          loadingLabel="Регистрируем…"
          disabled={pending || fullName.trim() === '' || groupName.trim() === ''}
        >
          Зарегистрироваться
        </Button>
      </form>

      <div className="mt-4">
        <Link href="/login">
          <Button variant="secondary" fullWidth disabled={pending}>
            Назад
          </Button>
        </Link>
      </div>

      <p className="mt-4 text-xs text-text-muted">
        В прототипе согласие провайдера эмулируется: реальных ключей нет, данные не покидают учебный
        стенд. После регистрации откроется профиль, расписание группы и общедоступные разделы;
        успеваемость — после верификации студенческого билета.
      </p>
    </Card>
  );
}

export default function RegisterPage(): React.JSX.Element {
  // useSearchParams требует Suspense-границы при статической генерации.
  return (
    <Suspense
      fallback={
        <Card>
          <Skeleton className="h-8 w-40" label="Загрузка формы регистрации…" />
          <Skeleton className="mt-4 h-11 w-full" />
          <Skeleton className="mt-3 h-11 w-full" />
          <Skeleton className="mt-3 h-11 w-full" />
        </Card>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}

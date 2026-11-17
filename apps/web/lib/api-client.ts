/**
 * Клиентский слой доступа к API кабинета (apps/web).
 *
 * Единственная точка, через которую браузерный код обращается к /api:
 * - CSRF (паттерн «двойная отправка», ARCHITECTURE §4): токен берётся из
 *   GET /api/auth/csrf и кешируется В ПАМЯТИ МОДУЛЯ. В localStorage /
 *   sessionStorage токен не пишется и не читается: секретов авторизации
 *   в браузере нет и быть не может, авторизация — только httpOnly-cookie,
 *   которую ставит сервер. Все мутирующие запросы (POST/PUT/PATCH/DELETE)
 *   уходят с заголовком x-csrf-token (CSRF_HEADER_NAME из packages/core —
 *   одно имя на клиенте и middleware);
 * - сервер ротирует CSRF-cookie при входе/выходе (issueCsrfCookie), поэтому
 *   кеш сбрасывается после login/logout/oauth-callback, а ответ
 *   CSRF_INVALID дополнительно даёт один повтор со свежим токеном —
 *   иначе первая же мутация после входа получила бы 403;
 * - ошибки приводятся к единому формату { error: { code, message, details } }
 *   (lib/http.ts на сервере) и бросаются как ApiClientError;
 * - 401 UNAUTHENTICATED (сессия истекла/отозвана) → редирект на /login
 *   ТОЛЬКО в браузерном окружении: в тестах и SSR window отсутствует.
 *   ВАЖНО: 401 INVALID_CREDENTIALS от входа редиректа НЕ вызывает —
 *   неверный пароль показывается формой, страница не уходит из-под пользователя;
 * - типизированные методы повторяют контракты роутов apps/web/app/api.
 *   Формы ответов — типы packages/core (единый источник истины), импортируются
 *   только как типы: клиентский бандл не тянет Prisma и argon2.
 *
 * Тесты подменяют fetch (createApiClient({ fetch })) — сеть не нужна.
 */
import type {
  MyProfile,
  MyVerification,
  SessionUser,
  VerificationGate,
} from '@udgu/core';

// ---------------------------------------------------------------------------
// Ошибки API
// ---------------------------------------------------------------------------

/**
 * Ошибка клиентского слоя: машинный код и сообщение приходят от сервера
 * в едином формате (lib/http.ts), details — сообщения уровня формы
 * («поле: причина») для полей ввода.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly string[];

  constructor(status: number, code: string, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Заголовок CSRF: имя общее с packages/core (CSRF_HEADER_NAME). */
const CSRF_HEADER = 'x-csrf-token';

/** Изменяющие методы — требуют CSRF-токен (как в middleware). */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Лимит фото студбилета, байт (MAX_ID_CARD_SIZE_BYTES в packages/core). */
const MAX_ID_CARD_PHOTO_BYTES = 5 * 1024 * 1024;

/** Форматы фото студбилета (ID_CARD_ALLOWED_MIME в packages/core). */
const ID_CARD_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

// ---------------------------------------------------------------------------
// Типы контрактов роутов
// ---------------------------------------------------------------------------

/** Провайдер OAuth-эмуляции: сегмент пути роутов (vk_id | max | telegram). */
export type OAuthProviderPath = 'vk_id' | 'max' | 'telegram';

export interface LoginInput {
  readonly login: string;
  readonly password: string;
}

/** POST /api/auth/login → { ok, redirectTo } (роль решает, куда). */
export interface LoginResult {
  readonly ok: boolean;
  readonly redirectTo: string;
}

/** GET /api/auth/session → пользователь сессии + гейт верификации. */
export interface SessionPayload {
  readonly user: SessionUser;
  readonly session: {
    readonly id: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  };
  /** Гейт верификации — только для STUDENT; у сотрудника/админа null. */
  readonly verificationGate: VerificationGate | null;
}

/** POST /api/auth/oauth/[provider]/start → ссылка страницы согласия. */
export interface OAuthStartResult {
  readonly consentUrl: string;
  readonly state: string;
  readonly expiresInSeconds: number;
}

/** Тело согласия: ФИО и группа обязательны (BRIEF v2), логин и ID аккаунта — нет. */
export interface OAuthCallbackInput {
  readonly state: string;
  readonly fullName: string;
  readonly groupName: string;
  readonly login?: string;
  readonly providerAccountId?: string;
}

/** POST /api/auth/oauth/[provider]/callback → { ok, redirectTo }. */
export interface OAuthCallbackResult {
  readonly ok: boolean;
  readonly redirectTo: string;
}

/** GET /api/verification → своя заявка (null — не подана) + гейт. */
export interface VerificationPayload {
  readonly verification: MyVerification | null;
  readonly verificationGate: VerificationGate;
}

/** GET /api/profile → свой профиль студента. */
export interface ProfilePayload {
  readonly profile: MyProfile;
}

export interface ApiClient {
  /** POST /api/auth/login — вход по логину/паролю университетской УЗ. */
  login(input: LoginInput): Promise<LoginResult>;
  /** POST /api/auth/logout — выход (сервер ревокает сессию и чистит cookie). */
  logout(): Promise<{ ok: boolean }>;
  /** GET /api/auth/session — кто вошёл и что открыто по гейту верификации. */
  getSession(): Promise<SessionPayload>;
  /** POST /api/auth/oauth/[provider]/start — начало регистрации через провайдера. */
  startOAuth(
    provider: OAuthProviderPath,
    prefill?: { login?: string; fullName?: string; groupName?: string },
  ): Promise<OAuthStartResult>;
  /** POST /api/auth/oauth/[provider]/callback — завершение эмуляции согласия. */
  oauthCallback(provider: OAuthProviderPath, input: OAuthCallbackInput): Promise<OAuthCallbackResult>;
  /** GET /api/verification — заявка на верификацию студбилета и гейт. */
  getVerification(): Promise<VerificationPayload>;
  /** POST /api/verification — multipart: номер билета + фото (приватное хранилище). */
  submitVerification(cardNumber: string, photo: File): Promise<{ verification: MyVerification }>;
  /** GET /api/profile — профиль студента сессии. */
  getProfile(): Promise<ProfilePayload>;
}

// ---------------------------------------------------------------------------
// Реализация
// ---------------------------------------------------------------------------

/**
 * Подменяемый fetch: глобальный по умолчанию, в тестах — заглушка.
 * Тип намеренно уже глобального fetch: реальный fetch ему удовлетворяет,
 * а тест получает узкий вход (путь-строка) и полный контроль ответа.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly fetch?: FetchLike;
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-тело: Content-Type выставляется автоматически. */
  readonly json?: unknown;
  /** Multipart-тело: Content-Type НЕ выставляется (boundary ставит fetch). */
  readonly form?: FormData;
  readonly headers?: Record<string, string>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  // Кеш CSRF-токена — в замыкании модульного экземпляра: в памяти,
  // без какого-либо хранилища браузера. csrfRequest дедуплицирует
  // параллельные обращения: токен запрашивается один раз.
  let csrfToken: string | null = null;
  let csrfRequest: Promise<string> | null = null;

  function invalidateCsrf(): void {
    csrfToken = null;
    csrfRequest = null;
  }

  async function ensureCsrfToken(): Promise<string> {
    if (csrfToken !== null) {
      return csrfToken;
    }
    csrfRequest ??= (async () => {
      const response = await fetchImpl('/api/auth/csrf', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as { csrfToken?: unknown } | null;
      const token = payload?.csrfToken;
      if (!response.ok || typeof token !== 'string' || token === '') {
        throw new ApiClientError(
          response.status,
          'CSRF_UNAVAILABLE',
          'Не удалось получить токен безопасности. Обновите страницу.',
        );
      }
      csrfToken = token;
      return token;
    })();
    try {
      return await csrfRequest;
    } finally {
      // Запрос завершён (успехом или ошибкой): следующий — заново.
      // При ошибке кеш остаётся пустым, повтор возможен.
      csrfRequest = null;
    }
  }

  function toApiClientError(status: number, payload: unknown): ApiClientError {
    const body = payload as { error?: unknown } | null;
    const error = body?.error as
      | { code?: unknown; message?: unknown; details?: unknown }
      | undefined;
    if (error !== undefined && error !== null && typeof error === 'object') {
      const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'INTERNAL';
      const message =
        typeof error.message === 'string' && error.message !== ''
          ? error.message
          : `Сервер вернул ошибку ${status}. Попробуйте позже.`;
      const details = Array.isArray(error.details)
        ? error.details.filter((item): item is string => typeof item === 'string')
        : [];
      return new ApiClientError(status, code, message, details);
    }
    return new ApiClientError(status, 'INTERNAL', `Сервер вернул ошибку ${status}. Попробуйте позже.`);
  }

  async function request<T>(path: string, options: RequestOptions, allowCsrfRetry = true): Promise<T> {
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    let body: BodyInit | null = null;

    if (options.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      // Content-Type намеренно не выставляем: браузер сам добавит
      // multipart/form-data с boundary — иначе сервер не разберёт файл.
      body = options.form;
    }

    if (MUTATING_METHODS.has(method)) {
      headers.set(CSRF_HEADER, await ensureCsrfToken());
    }

    const response = await fetchImpl(path, {
      method,
      headers,
      body,
      // Cookie сессии уходит автоматически: авторизация — только она,
      // клиент токены не читает и не хранит.
      credentials: 'same-origin',
    });

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const error = toApiClientError(response.status, payload);

      // Сервер ротирует CSRF-cookie (вход/выход) или токен устарел:
      // один повтор со свежим токеном. Повтор запрещён для самого
      // CSRF-запроса — иначе возможен цикл.
      if (error.code === 'CSRF_INVALID' && allowCsrfRetry && MUTATING_METHODS.has(method)) {
        invalidateCsrf();
        return request<T>(path, options, false);
      }

      // Сессия истекла — в браузере уводим на вход. INVALID_CREDENTIALS
      // (неверный пароль) остаётся на форме: редирект там был бы ошибкой.
      if (response.status === 401 && error.code === 'UNAUTHENTICATED' && typeof window !== 'undefined') {
        window.location.assign('/login');
      }
      throw error;
    }

    return payload as T;
  }

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      // Сервер выдаёт новую CSRF-cookie вместе с сессией — кеш токена
      // после входа недействителен.
      const result = await request<LoginResult>('/api/auth/login', {
        method: 'POST',
        json: input,
      });
      invalidateCsrf();
      return result;
    },

    async logout(): Promise<{ ok: boolean }> {
      const result = await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
      invalidateCsrf();
      return result;
    },

    async getSession(): Promise<SessionPayload> {
      return request<SessionPayload>('/api/auth/session', { method: 'GET' });
    },

    async startOAuth(
      provider: OAuthProviderPath,
      prefill?: { login?: string; fullName?: string; groupName?: string },
    ): Promise<OAuthStartResult> {
      return request<OAuthStartResult>(`/api/auth/oauth/${provider}/start`, {
        method: 'POST',
        json: prefill ?? {},
      });
    },

    async oauthCallback(
      provider: OAuthProviderPath,
      input: OAuthCallbackInput,
    ): Promise<OAuthCallbackResult> {
      // Пустые необязательные поля не отправляем: сервер сам выведет
      // логин и идентификатор аккаунта провайдера (BRIEF v2).
      const body: Record<string, string> = {
        state: input.state,
        fullName: input.fullName,
        groupName: input.groupName,
      };
      const login = input.login?.trim();
      if (login !== undefined && login !== '') {
        body.login = login;
      }
      const providerAccountId = input.providerAccountId?.trim();
      if (providerAccountId !== undefined && providerAccountId !== '') {
        body.providerAccountId = providerAccountId;
      }
      const result = await request<OAuthCallbackResult>(
        `/api/auth/oauth/${provider}/callback`,
        { method: 'POST', json: body },
      );
      invalidateCsrf();
      return result;
    },

    async getVerification(): Promise<VerificationPayload> {
      return request<VerificationPayload>('/api/verification', { method: 'GET' });
    },

    async submitVerification(cardNumber: string, photo: File): Promise<{ verification: MyVerification }> {
      const form = new FormData();
      form.set('cardNumber', cardNumber.trim());
      form.set('photo', photo);
      return request<{ verification: MyVerification }>('/api/verification', {
        method: 'POST',
        form,
      });
    },

    async getProfile(): Promise<ProfilePayload> {
      return request<ProfilePayload>('/api/profile', { method: 'GET' });
    },
  };
}

/**
 * Экземпляр по умолчанию: кеш CSRF живёт в памяти этого модуля.
 * Страницы кабинета используют его; тесты создают свои через createApiClient.
 */
export const api: ApiClient = createApiClient();

/** Лимит размера фото студбилета, байт (дублирует MAX_ID_CARD_SIZE_BYTES core для клиента). */
export const ID_CARD_PHOTO_MAX_BYTES = MAX_ID_CARD_PHOTO_BYTES;

/** Допустимые MIME фото студбилета (дублирует ID_CARD_ALLOWED_MIME core для клиента). */
export const ID_CARD_PHOTO_ALLOWED_MIME: readonly string[] = ID_CARD_PHOTO_MIME;

/** Проверка файла фото на клиенте: понятная ошибка до отправки на сервер. */
export function validateIdCardPhoto(file: File): string | null {
  if (!ID_CARD_PHOTO_ALLOWED_MIME.includes(file.type)) {
    return 'Фото должно быть в формате JPEG, PNG или WebP.';
  }
  if (file.size > MAX_ID_CARD_PHOTO_BYTES) {
    return 'Размер фото не должен превышать 5 МБ.';
  }
  return null;
}

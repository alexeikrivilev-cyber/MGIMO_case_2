/**
 * ТЕСТЫ КЛИЕНТСКОГО API-СЛОЯ (apps/web/lib/api-client.ts).
 *
 * Проверяются контракты, от которых зависит безопасность кабинета:
 * - CSRF: заголовок x-csrf-token на мутирующих запросах, отсутствие на GET,
 *   кеш токена (один запрос /api/auth/csrf на несколько POST), повтор
 *   после CSRF_INVALID со свежим токеном;
 * - единый формат ошибки { error: { code, message, details } } →
 *   ApiClientError с теми же полями;
 * - 401 UNAUTHENTICATED → редирект на /login (window.location.assign),
 *   в не-браузерном окружении — без падения;
 * - multipart верификации: FormData с cardNumber и photo, без Content-Type
 *   (boundary ставит браузер).
 *
 * fetch подменяется через createApiClient({ fetch }) — сети и БД тесту
 * не нужны, он проверяет только клиентский слой. Демо-пароль берётся из
 * @udgu/ui (единый источник с сидером и формой входа).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiClientError, type FetchLike } from '../lib/api-client';
import { DEMO_PASSWORD } from '@udgu/ui';

interface RecordedRequest {
  readonly path: string;
  readonly init: RequestInit;
  header(name: string): string | null;
}

interface FakeNetwork {
  readonly fetch: FetchLike;
  readonly requests: readonly RecordedRequest[];
}

/** Сеть-заглушка: пишет запросы и отдаёт ответы по правилу handler. */
function fakeNetwork(handler: (path: string, init: RequestInit) => Response | Promise<Response>): FakeNetwork {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const requestInit: RequestInit = init ?? {};
    requests.push({
      path: input,
      init: requestInit,
      header: (name: string) => new Headers(requestInit.headers).get(name),
    });
    return handler(input, requestInit);
  };
  return { fetch: fetchImpl, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string, details?: string[]): Response {
  return jsonResponse({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
}

/** Сеть с выдачей CSRF: handler вызывается только для целевого пути. */
function networkWithCsrf(
  csrfToken: string,
  handler: (path: string, init: RequestInit) => Response | Promise<Response>,
): FakeNetwork {
  return fakeNetwork(async (path, init) => {
    if (path === '/api/auth/csrf') {
      return jsonResponse({ csrfToken });
    }
    return handler(path, init);
  });
}

test('CSRF: заголовок x-csrf-token есть на POST и отсутствует на GET', async () => {
  const network = networkWithCsrf('csrf-token-1', (path) => {
    if (path === '/api/auth/login') {
      return jsonResponse({ ok: true, redirectTo: '/dashboard' });
    }
    if (path === '/api/auth/session') {
      return jsonResponse({
        user: { id: 'u1', login: 'student1', role: 'STUDENT', studentId: 's1', teacherId: null },
        session: { id: 'sess1', createdAt: '2026-11-17T00:00:00.000Z', expiresAt: '2026-11-24T00:00:00.000Z' },
        verificationGate: null,
      });
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  const login = await client.login({ login: 'student1', password: DEMO_PASSWORD });
  assert.equal(login.redirectTo, '/dashboard');

  await client.getSession();

  const [csrfRequest, loginRequest, sessionRequest] = network.requests;
  assert.equal(csrfRequest?.path, '/api/auth/csrf');
  assert.equal(csrfRequest?.init.method, 'GET');
  assert.equal(csrfRequest?.header('x-csrf-token'), null, 'выдача CSRF сама токен не шлёт');

  assert.equal(loginRequest?.init.method, 'POST');
  assert.equal(loginRequest?.header('x-csrf-token'), 'csrf-token-1');
  assert.equal(loginRequest?.header('content-type'), 'application/json');

  assert.equal(sessionRequest?.init.method, 'GET');
  assert.equal(sessionRequest?.header('x-csrf-token'), null, 'GET без CSRF-заголовка');
});

test('CSRF: токен кешируется в памяти — один запрос на несколько POST', async () => {
  const photo = new File(['photo-bytes'], 'student-card.jpg', { type: 'image/jpeg' });
  const network = networkWithCsrf('csrf-token-1', (path) => {
    if (path === '/api/verification') {
      return jsonResponse({
        verification: {
          id: 'v1',
          status: 'PENDING',
          recognizedLastName: 'Иванов',
          recognizedFirstName: 'Александр',
          recognizedGroupName: 'ПИ-31',
          recognizedCardNumber: 'ПИ-2023-0138',
          matchScore: 1,
          reviewComment: null,
          submittedAt: '2026-11-17T00:00:00.000Z',
          reviewedAt: null,
        },
      });
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  await client.submitVerification('ПИ-2023-0138', photo);
  await client.submitVerification('ПИ-2023-0138', photo);

  const csrfCalls = network.requests.filter((request) => request.path === '/api/auth/csrf');
  assert.equal(csrfCalls.length, 1, 'токен запрошен один раз');
  const posts = network.requests.filter((request) => request.path === '/api/verification');
  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.equal(post.header('x-csrf-token'), 'csrf-token-1');
  }
});

test('CSRF_INVALID → один повтор со свежим токеном', async () => {
  let csrfIssued = 0;
  let loginAttempts = 0;
  const network = fakeNetwork(async (path) => {
    if (path === '/api/auth/csrf') {
      csrfIssued += 1;
      return jsonResponse({ csrfToken: `csrf-${csrfIssued}` });
    }
    if (path === '/api/auth/login') {
      loginAttempts += 1;
      // Первая попытка — с устаревшим токеном (сервер ротировал cookie).
      return loginAttempts === 1
        ? errorResponse(403, 'CSRF_INVALID', 'Запрос отклонён: устарел или отсутствует CSRF-токен. Обновите страницу.')
        : jsonResponse({ ok: true, redirectTo: '/dashboard' });
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  const result = await client.login({ login: 'student1', password: DEMO_PASSWORD });

  assert.equal(result.ok, true);
  assert.equal(loginAttempts, 2, 'запрос повторён один раз');
  assert.equal(csrfIssued, 2, 'токен перевыпущен');
  const retriedPost = network.requests.filter((request) => request.path === '/api/auth/login')[1];
  assert.equal(retriedPost?.header('x-csrf-token'), 'csrf-2');
});

test('ошибка API → ApiClientError с code/message/details из единого формата', async () => {
  const network = networkWithCsrf('csrf-token-1', (path) => {
    if (path === '/api/auth/login') {
      return errorResponse(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.', ['login: укажите логин']);
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  await assert.rejects(
    () => client.login({ login: 'student1', password: 'wrong' }),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError, 'бросок ApiClientError');
      assert.equal(error.status, 401);
      assert.equal(error.code, 'INVALID_CREDENTIALS');
      assert.equal(error.message, 'Неверный логин или пароль.');
      assert.deepEqual(error.details, ['login: укажите логин']);
      return true;
    },
  );
});

test('ответ без единого формата ошибки → обобщённый ApiClientError', async () => {
  const network = networkWithCsrf('csrf-token-1', () => jsonResponse({ message: 'что-то пошло не так' }, 500));
  const client = createApiClient({ fetch: network.fetch });

  await assert.rejects(
    () => client.getSession(),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, 'INTERNAL');
      assert.equal(error.status, 500);
      assert.match(error.message, /Попробуйте позже/, 'обобщённое сообщение без технических деталей');
      return true;
    },
  );
});

test('401 UNAUTHENTICATED → редирект на /login (браузерное окружение)', async () => {
  const assigned: string[] = [];
  (globalThis as { window?: unknown }).window = {
    location: {
      assign: (url: string) => {
        assigned.push(url);
      },
    },
  };

  try {
    const network = networkWithCsrf('csrf-token-1', () =>
      errorResponse(401, 'UNAUTHENTICATED', 'Требуется вход в систему.'),
    );
    const client = createApiClient({ fetch: network.fetch });

    await assert.rejects(
      () => client.getSession(),
      (error: unknown) => error instanceof ApiClientError && error.code === 'UNAUTHENTICATED',
    );

    assert.deepEqual(assigned, ['/login'], 'пользователь уведён на страницу входа');
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test('401 UNAUTHENTICATED вне браузера → ошибка без падения на window', async () => {
  assert.equal(typeof globalThis.window, 'undefined', 'в node-окружении window нет');

  const network = networkWithCsrf('csrf-token-1', () =>
    errorResponse(401, 'UNAUTHENTICATED', 'Требуется вход в систему.'),
  );
  const client = createApiClient({ fetch: network.fetch });

  await assert.rejects(
    () => client.getSession(),
    (error: unknown) => error instanceof ApiClientError && error.code === 'UNAUTHENTICATED',
  );
});

test('401 INVALID_CREDENTIALS не вызывает редирект (форма входа остаётся)', async () => {
  const assigned: string[] = [];
  (globalThis as { window?: unknown }).window = {
    location: {
      assign: (url: string) => {
        assigned.push(url);
      },
    },
  };

  try {
    const network = networkWithCsrf('csrf-token-1', () =>
      errorResponse(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.'),
    );
    const client = createApiClient({ fetch: network.fetch });

    await assert.rejects(
      () => client.login({ login: 'student1', password: 'wrong' }),
      (error: unknown) => error instanceof ApiClientError && error.code === 'INVALID_CREDENTIALS',
    );

    assert.deepEqual(assigned, [], 'неверный пароль не уводит со страницы входа');
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test('верификация: multipart с cardNumber и photo, без Content-Type', async () => {
  const photo = new File(['photo-bytes'], 'student-card.jpg', { type: 'image/jpeg' });
  const network = networkWithCsrf('csrf-token-1', (path) => {
    if (path === '/api/verification') {
      return jsonResponse({
        verification: {
          id: 'v1',
          status: 'PENDING',
          recognizedLastName: 'Иванов',
          recognizedFirstName: 'Александр',
          recognizedGroupName: 'ПИ-31',
          recognizedCardNumber: 'ПИ-2023-0138',
          matchScore: 1,
          reviewComment: null,
          submittedAt: '2026-11-17T00:00:00.000Z',
          reviewedAt: null,
        },
      });
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  const result = await client.submitVerification(' ПИ-2023-0138 ', photo);
  assert.equal(result.verification.status, 'PENDING');

  const post = network.requests.find((request) => request.path === '/api/verification');
  assert.ok(post !== undefined, 'POST /api/verification отправлен');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.header('x-csrf-token'), 'csrf-token-1', 'мутация идёт с CSRF-заголовком');
  assert.equal(post.header('content-type'), null, 'boundary multipart ставит браузер, не клиент');

  const body = post.init.body;
  assert.ok(body instanceof FormData, 'тело — FormData');
  assert.equal(body.get('cardNumber'), 'ПИ-2023-0138', 'номер обрезан по краям');
  const sentPhoto = body.get('photo');
  assert.ok(sentPhoto instanceof File, 'фото приложено');
  assert.equal(sentPhoto.name, 'student-card.jpg');
  assert.equal(sentPhoto.type, 'image/jpeg');
});

test('oauth-callback: пустые необязательные поля не отправляются', async () => {
  let sentBody: unknown = null;
  const network = networkWithCsrf('csrf-token-1', (path) => {
    if (path === '/api/auth/oauth/vk_id/callback') {
      return jsonResponse({ ok: true, redirectTo: '/dashboard' });
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({
    fetch: async (input, init) => {
      if (input === '/api/auth/oauth/vk_id/callback' && typeof init?.body === 'string') {
        sentBody = JSON.parse(init.body) as unknown;
      }
      return network.fetch(input, init);
    },
  });

  const result = await client.oauthCallback('vk_id', {
    state: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    fullName: 'Иванов Александр Дмитриевич',
    groupName: 'ПИ-31',
    login: '   ',
    providerAccountId: '',
  });

  assert.equal(result.redirectTo, '/dashboard');
  assert.deepEqual(sentBody, {
    state: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    fullName: 'Иванов Александр Дмитриевич',
    groupName: 'ПИ-31',
  });
});

test('oauth-start: prefill уходит телом на путь провайдера', async () => {
  let sentPath = '';
  let sentBody: unknown = null;
  const network = fakeNetwork(async (path, init) => {
    if (path === '/api/auth/csrf') {
      return jsonResponse({ csrfToken: 'csrf-token-1' });
    }
    if (path === '/api/auth/oauth/telegram/start') {
      sentPath = path;
      sentBody = JSON.parse(String(init.body)) as unknown;
      return jsonResponse({
        consentUrl: '/register?state=a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        state: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        expiresInSeconds: 600,
      });
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  const result = await client.startOAuth('telegram', { groupName: 'ПИ-31' });

  assert.equal(sentPath, '/api/auth/oauth/telegram/start');
  assert.deepEqual(sentBody, { groupName: 'ПИ-31' });
  assert.equal(result.consentUrl, '/register?state=a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(result.expiresInSeconds, 600);
});

test('выдача CSRF недоступна → понятная ошибка, а не молчаливый провал', async () => {
  const network = fakeNetwork(async (path) => {
    if (path === '/api/auth/csrf') {
      return jsonResponse({ error: { code: 'INTERNAL', message: 'Сервер недоступен.' } }, 500);
    }
    throw new Error(`Неожиданный путь ${path}`);
  });
  const client = createApiClient({ fetch: network.fetch });

  await assert.rejects(
    () => client.logout(),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, 'CSRF_UNAVAILABLE');
      assert.match(error.message, /токен/i);
      return true;
    },
  );
});

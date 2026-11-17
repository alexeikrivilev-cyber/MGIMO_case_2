/*
 * Service worker кабинета «Цифровой деканат» — оффлайн-оболочка (PWA).
 *
 * Правила (осознанные, не «покешировать всё»):
 * 1. НАВИГАЦИЯ (mode === 'navigate') — сначала сеть, при отсутствии
 *    сети отдаём закешированную оболочку входа (/login): именно её
 *    получает аноним, и именно там начинается любой сценарий. Реальный
 *    HTML страниц кабинета НЕ кешируется — в нём персональные данные
 *    студента (ФИО, расписание, оценки), а кеш переживает выход из
 *    аккаунта на чужом устройстве.
 * 2. СТАТИКА Next (_next/static) — cache-first с ограничением по числу
 *    записей: immutable-ассеты сборки меняются только со сборкой.
 * 3. API (/api/*) — НЕ кешируется НИКОГДА: все данные персонализированы
 *    (свои оценки, свои заявки, своя переписка), плюс ответы уходят
 *    клиенту через httpOnly-cookie сессии.
 * 4. RSC-запросы (заголовок RSC) — не кешируются: это персонализированные
 *    потоки данных страниц кабинета.
 * 5. Секретов в кеше нет и быть не может: в браузере нет ни токенов
 *    сессии (httpOnly-cookie), ни ключей — только httpOnly-cookie.
 *
 * Сторонних PWA-библиотек нет: регистрация — свой минимальный клиентский
 * компонент (components/ServiceWorkerRegister.tsx), только в production.
 */

const SHELL_CACHE = 'udgu-shell-v1';
const STATIC_CACHE = 'udgu-static-v1';

/** Оболочка входа: единственный URL, который переживает оффлайн. */
const SHELL_URL = '/login';

/** Ассеты оболочки, которые precache делает на install. */
const SHELL_ASSETS = [
  SHELL_URL,
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];

/** Предел числа записей в кеше статики Next. */
const STATIC_ENTRY_LIMIT = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll падает целиком, если хоть один URL недоступен: добавляем
      // по одному, чтобы сеть на момент установки не сломала регистрацию.
      await Promise.all(
        SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Персональные данные API и RSC-потоки — мимо кеша.
  if (url.pathname.startsWith('/api/') || request.headers.get('RSC') === '1') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staticResponse(request));
    return;
  }

  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/icon-') || url.pathname === '/icon.svg') {
    event.respondWith(staticResponse(request));
  }
});

/** Навигация: сеть first, оффлайн — закешированная оболочка входа. */
async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Ответ страницы кабинета в кеш не пишем: персональные данные.
    return response;
  } catch {
    const shell = await cache.match(SHELL_URL);
    if (shell !== undefined) {
      return shell;
    }
    // Кеш пуст (первый визит оффлайн): отдаём минимальную страницу,
    // чтобы браузер не показал свою ошибку «нет соединения».
    return new Response(
      '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Нет соединения</title></head>' +
        '<body style="font-family:system-ui,sans-serif;background:#0b0e14;color:#e8ebf2;' +
        'display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">' +
        '<div><h1 style="font-size:1.25rem;margin:0 0 8px">Нет соединения</h1>' +
        '<p style="color:#9aa4b8;margin:0">Кабинет откроется, когда появится сеть.</p></div>' +
        '</body></html>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}

/** Статика Next и иконки: cache-first, число записей ограничено. */
async function staticResponse(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(request);
  if (response !== undefined && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    await trimCache(cache, STATIC_ENTRY_LIMIT);
  }
  return response;
}

/** Ограничение размера кеша: удаляем самые старые записи сверх лимита. */
async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) {
    return;
  }
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

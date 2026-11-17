/**
 * ТЕСТ PWA-СЛОЯ (P1.5): манифест, иконки знака, service worker.
 *
 * Проверяем то, что нельзя проверить глазами в браузере и что легко
 * сломать правкой одной строки:
 * - манифест валиден по полям и ведёт на /login (вход — точка старта
 *   для анонима, именно её отдаёт сервер);
 * - цвета манифеста взяты из ТЁМНЫХ токенов (тема по умолчанию);
 * - знак концепта — свой (в манифесте и в public/ только наши файлы,
 *   логотип вуза не используется по требованию кейса);
 * - PNG-иконки существуют и имеют заявленные размеры (читаем IHDR);
 * - service worker не кеширует /api/* (персональные данные) и умеет
 *   отдавать оболочку входа без сети;
 * - воркер регистрируется только в production (компонент + lэйаут).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(webDir, 'public');

function readPublic(name: string): string {
  const filePath = path.join(publicDir, name);
  assert.ok(existsSync(filePath), `public/${name} не найден`);
  return readFileSync(filePath, 'utf8');
}

/** Размеры PNG из заголовка IHDR (без сторонних библиотек). */
function pngSize(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.toString('latin1', 1, 4), 'PNG', `${path.basename(filePath)} — не PNG`);
  assert.equal(buffer.toString('latin1', 12, 16), 'IHDR', `${path.basename(filePath)} — нет IHDR`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Манифест
// ---------------------------------------------------------------------------

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface WebManifest {
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly lang: string;
  readonly icons: readonly ManifestIcon[];
}

const manifest = JSON.parse(readPublic('manifest.webmanifest')) as WebManifest;

test('манифест: обязательные поля PWA', () => {
  assert.equal(manifest.name, 'Цифровой деканат — УдГУ');
  assert.equal(manifest.short_name, 'Деканат УдГУ');
  assert.equal(manifest.start_url, '/login', 'старт — экран входа: именно он доступен анониму');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ru');
});

test('манифест: описание помечает прототип как учебный концепт', () => {
  // Требование кейса: на сайте и в установке понятно, что это концепт.
  assert.match(manifest.description, /учебный концепт/i, 'в описании сказано, что это учебный концепт');
  assert.match(manifest.description, /не официальный сервис/i, 'в описании сказано, что это не официальный сервис');
});

test('манифест: цвета из тёмных токенов (тема по умолчанию)', () => {
  // bg #0b0e14 и primary #818cf8 — packages/ui/tokens.css, блок .dark.
  assert.equal(manifest.background_color, '#0b0e14');
  assert.equal(manifest.theme_color, '#818cf8');

  const css = readFileSync(path.resolve(webDir, '../../packages/ui/tokens.css'), 'utf8');
  assert.match(css, /--udgu-color-bg:\s*#0b0e14;/, 'фон манифеста совпадает с токеном bg тёмной темы');
  assert.match(css, /--udgu-color-primary:\s*#818cf8;/, 'theme_color совпадает с токеном primary тёмной темы');
});

test('манифест: иконки — 192, 512, maskable и SVG', () => {
  const byPurpose = (purpose: string): readonly ManifestIcon[] =>
    manifest.icons.filter((icon) => icon.purpose === purpose);

  const any = byPurpose('any');
  assert.ok(any.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'), 'иконка 192×192');
  assert.ok(any.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'), 'иконка 512×512');
  assert.ok(
    any.some((icon) => icon.sizes === 'any' && icon.type === 'image/svg+xml'),
    'SVG-иконка (масштабируется без потерь)',
  );
  assert.ok(
    byPurpose('maskable').some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'),
    'maskable-иконка 512×512',
  );

  // Каждый заявленный в манифесте файл реально лежит в public/.
  for (const icon of manifest.icons) {
    const name = icon.src.replace(/^\//, '');
    assert.ok(existsSync(path.join(publicDir, name)), `public/${name} — файл иконки из манифеста`);
  }
});

test('иконки: PNG имеют заявленные размеры', () => {
  assert.deepEqual(pngSize(path.join(publicDir, 'icon-192.png')), { width: 192, height: 192 });
  assert.deepEqual(pngSize(path.join(publicDir, 'icon-512.png')), { width: 512, height: 512 });
  assert.deepEqual(pngSize(path.join(publicDir, 'icon-maskable-512.png')), { width: 512, height: 512 });
  assert.deepEqual(pngSize(path.join(publicDir, 'apple-touch-icon-180.png')), { width: 180, height: 180 });
});

test('иконки: maskable и apple-touch-icon без прозрачности (полный фон)', () => {
  // Прозрачный край на maskable даёт «дырку» под маской Android, а iOS
  // рисует свой скруглённый прямоугольник поверх чёрного фона. Поэтому
  // полнофонные иконки сохраняются без альфа-канала (цветовой тип 2 = RGB).
  for (const name of ['icon-maskable-512.png', 'apple-touch-icon-180.png']) {
    const buffer = readFileSync(path.join(publicDir, name));
    assert.equal(buffer.toString('latin1', 1, 4), 'PNG', `${name} — не PNG`);
    assert.equal(buffer.toString('latin1', 12, 16), 'IHDR', `${name} — нет IHDR`);
    // IHDR: байт 25 — цветовой тип (2 = RGB без альфы, 6 = RGBA).
    assert.equal(buffer.readUInt8(25), 2, `${name}: ожидался RGB без альфа-канала`);
  }

  // Обычные иконки сохраняют скруглённую плитку — угол прозрачный.
  const rounded = readFileSync(path.join(publicDir, 'icon-512.png'));
  assert.equal(rounded.readUInt8(25), 6, 'icon-512.png: скруглённая плитка — RGBA');
});

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

const serviceWorker = readPublic('sw.js');

test('service worker: не кеширует API (персональные данные)', () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/, 'запросы к API перехватываются');
  // После проверки пути API воркер выходит без respondWith: кеша нет.
  const guard = serviceWorker.slice(serviceWorker.indexOf("startsWith('/api/')"));
  assert.match(guard.slice(0, 400), /return;/, 'для /api/* воркер выходит, не касаясь кеша');
  assert.ok(!/cache\.(put|add)\([^)]*api/i.test(serviceWorker), 'в кеш не попадают ответы API');
});

test('service worker: оболочка входа переживает оффлайн', () => {
  assert.match(serviceWorker, /mode === 'navigate'/, 'навигационные запросы обрабатываются отдельно');
  assert.match(serviceWorker, /'\/login'/, 'оболочка входа закеширована');
  assert.match(serviceWorker, /SHELL_ASSETS/, 'список ассетов оболочки есть');
  // Статика Next — cache-first с ограничением числа записей.
  assert.match(serviceWorker, /_next\/static/, 'статика Next кешируется');
  assert.match(serviceWorker, /STATIC_ENTRY_LIMIT/, 'число записей в кеше статики ограничено');
  // RSC-потоки страниц кабинета не кешируются.
  assert.match(serviceWorker, /'RSC'/, 'RSC-запросы не кешируются');
});

test('service worker: в нём нет секретов и внешних адресов', () => {
  assert.ok(!/https?:\/\//.test(serviceWorker), 'в воркере нет внешних URL');
  assert.ok(!/token|secret|password|apiKey/i.test(serviceWorker), 'в воркере нет упоминаний секретов');
});

test('service worker: заголовок Service-Worker-Allowed и регистрация только в production', () => {
  const config = readFileSync(path.join(webDir, 'next.config.ts'), 'utf8');
  assert.match(config, /Service-Worker-Allowed/, 'next.config отдаёт заголовок Service-Worker-Allowed: /');
  assert.match(config, /value:\s*'\/'/, 'scope воркера — весь сайт');

  const register = readFileSync(path.join(webDir, 'components/ServiceWorkerRegister.tsx'), 'utf8');
  assert.match(register, /NODE_ENV !== 'production'/, 'в dev-режиме воркер не регистрируется');
  assert.match(register, /serviceWorker\.register\('\/sw\.js'/, 'регистрация идёт по /sw.js');

  const layout = readFileSync(path.join(webDir, 'app/layout.tsx'), 'utf8');
  assert.match(layout, /<ServiceWorkerRegister \/>/, 'компонент регистрации в корневом лэйауте');
  assert.match(layout, /manifest: '\/manifest\.webmanifest'/, 'манифест подключён в metadata');
  assert.match(layout, /apple-touch-icon-180\.png/, 'apple-touch-icon подключён в metadata');
});

test('иконка знака: своя, без логотипа вуза и без внешних ресурсов', () => {
  const icon = readPublic('icon.svg');
  assert.match(icon, /viewBox="0 0 512 512"/, 'квадратная сетка знака');
  assert.ok(!/<image/i.test(icon), 'в знаке нет встроенных растровых изображений');
  // xmlns — служебное пространство SVG, а не сетевой ресурс: внешних
  // ссылок (href/xlink:href) в знаке быть не должно.
  assert.ok(!/href=/i.test(icon), 'знак не ссылается на внешние файлы');
  assert.ok(!/<script/i.test(icon), 'в знаке нет скриптов');
  // Цвета знака — токены палитры кабинета.
  assert.match(icon, /#0b0e14/, 'фон знака — токен bg тёмной темы');
  assert.match(icon, /#818cf8/, 'контур знака — токен primary тёмной темы');
  assert.match(icon, /#a5b4fc/, 'акценты знака — токен primary-hover тёмной темы');

  // Скрипт перегенерации лежит в репозитории (документ процесса).
  const script = path.join(webDir, 'scripts/generate-icons.py');
  assert.ok(existsSync(script), 'apps/web/scripts/generate-icons.py в репозитории');
  assert.match(readFileSync(script, 'utf8'), /icon\.svg/, 'скрипт генерирует PNG из public/icon.svg');
});

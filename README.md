# Цифровой деканат будущего (proj-3311)

Прототип личного кабинета студента **Удмуртского государственного университета (УдГУ)**, город Ижевск: расписание, успеваемость, заявки/справки и уведомления в одном месте. Кейс — `docs/CASE.md`, архитектура — `docs/ARCHITECTURE.md`. **Все данные в системе синтетические** (ФИО, оценки, зачётки, фото студбилетов — вымышленные), никаких настоящих персональных данных и никаких подключений к реальным системам вуза. Это учебный концепт, не официальный сервис УдГУ.

## Демо (работающий прототип)

**https://177-3-196-28.nip.io/** — прод-выкладка на Helsinki VPS (Docker, PostgreSQL 16,
HTTPS с сертификатом Let's Encrypt; HTTP отдаёт 308-редирект на HTTPS).
Вход — по тестовым аккаунтам из раздела «Тестовые аккаунты» ниже.
Ссылка работает из России без VPN.


## Структура

```
apps/web          # кабинет студента (Next.js 15.5, App Router, Tailwind CSS 4)
packages/db       # Prisma 7.10 + PostgreSQL 16: схема, миграции, сидер
packages/ui       # дизайн-токены (tokens.css + tokens.ts)
packages/core     # доменная логика: приватное хранилище фото студбилетов, далее — авторизация и сервисы
storage/          # приватное хранилище фото студбилетов (ВНЕ webroot, в git только .gitkeep)
docs/             # кейс, бриф, архитектура, PRD, роадмап, план, лог процесса
```

## Быстрый старт

Нужны Node.js 24+ и Docker.

```bash
cp .env.example .env
docker compose up -d db      # PostgreSQL 16 на localhost:5432
npm install
npm run db:migrate           # создать и применить миграцию
npm run db:seed              # заполнить базу вымышленными данными
npm run dev                  # http://localhost:3000
```

## Скрипты

| Скрипт | Что делает |
| --- | --- |
| `npm run dev` | запуск `apps/web` в режиме разработки |
| `npm run build` | сборка всего: Prisma Client + Next.js |
| `npm start` | прод-запуск собранного `apps/web` |
| `npm run db:generate` | сгенерировать Prisma Client |
| `npm run db:migrate` | создать и применить миграцию (`prisma migrate dev`); имя: `npm run db:migrate --name=<slug>` |
| `npm run db:deploy` | применить существующие миграции |
| `npm run db:seed` | заполнить базу вымышленными данными |
| `npm run db:reset` | SQL-очистка схемы через docker exec + migrate deploy + seed (без `prisma migrate reset`) |
| `npm test` | тесты `@udgu/db`, `@udgu/core` и `@udgu/web` (роуты, IDOR, страницы, контраст, паритет токенов, PWA), node:test + tsx |
| `npm run typecheck` | `tsc --noEmit` во всех воркспейсах |
| `python3 apps/web/scripts/generate-icons.py` | перегенерировать PNG-иконки знака концепта из `apps/web/public/icon.svg` (нужен Python 3 + Pillow) |

## PWA, знак концепта и доступность

**Знак концепта — свой, не логотип вуза** (требование кейса). Идея: «страница-расписание
с печатью „всё учтено“» — контур страницы, строки пар и галочка контроля в фирменных
токенах кабинета. Источник истины по геометрии — `apps/web/public/icon.svg`; из него
скриптом `apps/web/scripts/generate-icons.py` (Python + Pillow, без сетевых ресурсов)
генерируются PNG, которые тоже лежат в репозитории:

| Файл | Размер | Для чего |
| --- | --- | --- |
| `public/icon.svg` | любое | favicon и `purpose: any` в манифесте |
| `public/icon-192.png` | 192×192 | установка PWA (Android/Chrome) |
| `public/icon-512.png` | 512×512 | установка PWA, splash-экраны |
| `public/icon-maskable-512.png` | 512×512 | маска Android: полнофонный, знак в safe-zone 80% |
| `public/apple-touch-icon-180.png` | 180×180 | iOS: полнофонный, система сама скругляет углы |

Перегенерировать после правки `icon.svg`:

```bash
python3 apps/web/scripts/generate-icons.py          # пути по умолчанию (public/)
python3 apps/web/scripts/generate-icons.py --svg apps/web/public/icon.svg --out apps/web/public
```

**Манифест** — `apps/web/public/manifest.webmanifest`, рукописный (сторонних PWA-библиотек
нет): `name` «Цифровой деканат — УдГУ», `short_name` «Деканат УдГУ», `start_url` `/login`
(вход — то, что получает аноним), `display: standalone`, цвета из **тёмных** токенов
(`background_color` `#0b0e14`, `theme_color` `#818cf8`). В описании прямым текстом сказано,
что это учебный концепт, а не официальный сервис.

**Service worker** — `apps/web/public/sw.js`, регистрируется только в production
(`components/ServiceWorkerRegister.tsx`, в dev не мешает HMR). Поведение:
навигация — сначала сеть, без сети отдаёт закешированную оболочку `/login`;
статика `_next/static` — cache-first с лимитом 60 записей; **API не кешируется никогда**
(персональные данные), RSC-потоки — тоже; HTML страниц кабинета в кеш не пишется.
Заголовок `Service-Worker-Allowed: /` (scope на весь сайт) и `no-store` для самого воркера —
в `apps/web/next.config.ts`.

**Доступность (WCAG 2.2 AA).** Skip-link «Перейти к содержимому» — первый фокус-элемент
экранов входа и кабинета; видимый `focus-visible` у каждого интерактивного элемента;
`aria-current="page"` на активном разделе; нижняя навигация — `<nav aria-label="Основная
навигация">`; ошибки форм — `role="alert"` + `aria-describedby`; статусы кодируются
формой **и** словом; `prefers-reduced-motion` гасит все анимации и переходы. Пороги
контраста закреплены тестами: `apps/web/test/contrast.test.ts` (все пары «текст →
поверхность» ≥ 4.5:1 в светлой и тёмной темах) и `apps/web/test/tokens-parity.test.ts`
(`packages/ui/src/tokens.ts` и `packages/ui/tokens.css` не разойдутся).

## Docker

```bash
docker compose up -d          # db + web (web слушает порт 3000)
docker compose up -d db       # только база
```

Образ `web` собирается из `apps/web/Dockerfile` (Next.js standalone).
Пароли только из переменных окружения (`.env`), в коде и compose их нет.

## Приватное хранилище фото студбилетов

Фото студенческих билетов (заявки на верификацию) лежат в `storage/id-cards/<studentId>/<uuid>.<ext>`
в корне репозитория — **вне webroot**: Next.js отдаёт как статику только `public/`,
поэтому прямых ссылок на файлы нет, доступ только через серверный код владельцу
и верификатору. В базе хранится только путь относительно корня хранилища.

- Корень переопределяется переменной `STORAGE_DIR` (см. `.env.example`).
- Каталог `storage/` в `.gitignore` (в git попадает только `storage/id-cards/.gitkeep`).
- Валидация и защита от выхода за пределы каталога — `packages/core/src/storage.ts`
  (MIME только `image/jpeg` / `image/png` / `image/webp`, размер ≤ 5 МБ),
  тесты — `packages/core/test/storage.test.ts`.

## Тестовые аккаунты (вымышленные)

Пароль всех аккаунтов — `password123`. Пароли хранятся в базе
argon2id-хешами.

| Логин | Пароль | Кто |
| --- | --- | --- |
| `student1` | `password123` | Иванов А. Д., прикладная информатика (есть один незачёт, верифицирован, VK ID) |
| `student2` | `password123` | Петрова М. А., бизнес-информатика (отметила болезнь, заявка на верификации в очереди, Telegram) |
| `student3` | `password123` | Смирнов Н. И., юриспруденция (верификация отклонена: несовпадение группы) |
| `student4` | `password123` | Кузнецова А. С., педагогическое образование (верифицирована) |
| `staff1` | `password123` | Сотрудник деканата |
| `admin1` | `password123` | Администратор |

Преподаватели: `teacher1` … `teacher16` (роль STAFF, по 2 на каждый институт).

## Состояние

Готово (P1.1 «Фундамент»): монорепо, схема БД, сидер с
переносами/отменами в расписании, дизайн-токены, каркас web-приложения,
docker-compose, тесты сидера.
Готово (P1.2 «Пивот на УдГУ + расширение схемы»): вуз — УдГУ (институты,
реальные коды направлений), новые модели `IdentityRegistry`,
`StudentVerification`, `OAuthAccount`/`OAuthIntent`, `SickLeave`,
`OfficeHour`, приватное хранилище фото студбилетов.
Готово (P1.3 «Домен и безопасность»): argon2id + httpOnly-сессии,
rate-limit на вход, владение данными и анти-IDOR, сервисы
profile/schedule/grades/requests/notifications/announcements/sickleave/
verification/teachers, мок-распознавание студбилета.
Готово (P1.4 «API и страницы кабинета»): middleware безопасности
(заголовки, CSRF, гейтинг), все роуты `/api/*`, 12 экранов кабинета
(вход/регистрация с эмуляцией OAuth, дашборд, расписание, успеваемость,
заявки, уведомления, объявления, профиль, верификация, «болею»,
преподаватели), скелетоны и пустые состояния.
Готово (P1.5 «Качество»): PWA-установка (манифест, свой знак, service
worker с оффлайн-оболочкой), WCAG 2.2 AA (контраст, фокус, skip-link,
aria), паритет токенов, `prefers-reduced-motion`, тёмная тема по
умолчанию.
Дальше — P2: кабинет сотрудника деканата, переписка с преподавателями,
AI-ассистенты, MCP-сервер, боты Telegram / VK / MAX на общем бэкенде.

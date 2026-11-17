# Цифровой деканат будущего (proj-3311)

Прототип личного кабинета студента вымышленного Университета «Горизонт»: расписание, успеваемость, заявки/справки и уведомления в одном месте. Кейс — `docs/CASE.md`, архитектура — `docs/ARCHITECTURE.md`. **Все данные в системе синтетические**, никаких настоящих персональных данных.

## Структура

```
apps/web          # кабинет студента (Next.js 15.5, App Router, Tailwind CSS 4)
packages/db       # Prisma 7.10 + PostgreSQL 16: схема, миграции, сидер
packages/ui       # дизайн-токены (tokens.css + tokens.ts)
packages/core     # доменная логика (заготовка, наполняется на P1.2)
docs/             # кейс, архитектура, план, лог процесса
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
| `npm run start` | прод-запуск собранного `apps/web` |
| `npm run db:migrate` | создать и применить миграцию Prisma |
| `npm run db:deploy` | применить существующие миграции |
| `npm run db:seed` | заполнить базу вымышленными данными |
| `npm run db:reset` | SQL-очистка схемы через docker exec + migrate deploy + seed (без `prisma migrate reset`) |
| `npm test` | тесты пакета `@horizon/db` (инварианты сидера, node:test) |
| `npm run typecheck` | `tsc --noEmit` во всех воркспейсах |

## Docker

```bash
docker compose up -d          # db + web (web слушает порт 3000)
docker compose up -d db       # только база
```

Образ `web` собирается из `apps/web/Dockerfile` (Next.js standalone).
Пароли только из переменных окружения (`.env`), в коде и compose их нет.

## Тестовые аккаунты (вымышленные)

Пароль всех аккаунтов — `password123`. Пароли хранятся в базе
argon2id-хешами.

| Логин | Пароль | Кто |
| --- | --- | --- |
| `student1` | `password123` | Иванов А. Д., группа ИТ-21-1 (есть один незачёт) |
| `student2` | `password123` | Петрова М. А., группа ЭК-22-1 |
| `student3` | `password123` | Смирнов Н. И., группа ИТ-21-2 |
| `student4` | `password123` | Кузнецова А. С., группа ИН-20-1 |
| `staff1` | `password123` | Сотрудник деканата |
| `admin1` | `password123` | Администратор |

Преподаватели: `teacher1` … `teacher12` (роль STAFF).

## Состояние

Готово (P1.1 «Фундамент»): монорепо, схема БД, сидер с
переносами/отменами в расписании, дизайн-токены, каркас web-приложения,
docker-compose, тесты сидера. Вход по логину/паролю (P1.3) — следующий шаг.

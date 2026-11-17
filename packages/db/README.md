# @horizon/db — слой данных Университета «Горизонт»

Prisma 7.10 + PostgreSQL 16. Схема, миграции и сидер синтетических данных.

## Переменные окружения

| Переменная | Где | Зачем |
| --- | --- | --- |
| `DATABASE_URL` | `.env` в корне монорепо | строка подключения Prisma |

`.env` автоматически не хранится в git (см. `.gitignore`); образец — `.env.example` в корне.

## Команды (из корня монорепо)

```bash
npm run db:generate   # сгенерировать Prisma Client (provider prisma-client → src/generated)
npm run db:migrate    # создать и применить миграцию (prisma migrate dev)
npm run db:deploy     # применить существующие миграции (prisma migrate deploy)
npm run db:seed       # заполнить БД вымышленными данными
npm run db:reset      # SQL-очистка схемы (docker exec) + migrate deploy + seed
npm test              # инварианты сидера (node:test + tsx)
```

## Модели

`User`, `Student`, `Teacher`, `Subject`, `Group`, `ScheduleEntry`, `Grade`,
`Request`, `Announcement`, `Notification`, `Session`, `AuditEvent` — полное
описание полей и связей в `prisma/schema.prisma` (источник истины).

Ключевые решения по FK:
- `Student.userId` / `Teacher.userId` → `User` с `onDelete: Restrict`:
  удаление пользователя не должно каскадом уносить оценки и заявки.
- `ScheduleEntry.subjectId` / `teacherId`, `Grade.subjectId` → `Restrict`:
  справочники защищены от удаления, пока на них ссылается учёба.
- `ScheduleEntry.groupId`, `Grade.studentId`, `Request.studentId` → `Cascade`:
  удаление группы/студента уносит их зависимые записи учёты.
- `Session`, `Notification` → `Cascade` от `User` (жизненный цикл пользователя).

## Сидер

`prisma/seed.ts` пишет в БД данные, сгенерированные чистой функцией
`buildSeedData()` из `src/seed-data.ts` (детерминированный PRNG, без обращений
к БД — поэтому инварианты проверяются тестами без PostgreSQL).

Состав: 4 факультета, 8 групп, 40 предметов, 12 преподавателей, 4 студента +
staff1 + admin1; расписание на 2 недели вперёд (5-6 пар в будний день,
включая переносы `MOVED` и отмены `CANCELLED`); оценки за 2 семестра
(у student1 — один незачёт); заявки, объявления, уведомления, аудит.

Пароль всех тестовых аккаунтов — argon2id-хеш от `password123` (фикстура
сидера; в продакшене пароли задаются только через окружение).

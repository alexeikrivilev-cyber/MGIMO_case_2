# @udgu/db — слой данных УдГУ

Prisma 7.10 + PostgreSQL 16. Схема, миграции и сидер синтетических данных
Удмуртского государственного университета (УдГУ), город Ижевск.

## Переменные окружения

| Переменная | Где | Зачем |
| --- | --- | --- |
| `DATABASE_URL` | `.env` в корне монорепо | строка подключения Prisma |
| `STORAGE_DIR` | `.env` в корне монорепо (необязательно) | корень приватного хранилища фото студбилетов; по умолчанию — `storage/` в корне монорепо |

`.env` автоматически не хранится в git (см. `.gitignore`); образец — `.env.example` в корне.

## Команды (из корня монорепо)

```bash
npm run db:generate   # сгенерировать Prisma Client (provider prisma-client → src/generated)
npm run db:migrate    # создать и применить миграцию (prisma migrate dev)
                      # имя миграции: npm run db:migrate --name=<slug>
npm run db:deploy     # применить существующие миграции (prisma migrate deploy)
npm run db:seed       # заполнить БД вымышленными данными
npm run db:reset      # SQL-очистка схемы (docker exec) + migrate deploy + seed
npm test              # инварианты сидера (node:test + tsx)
```

## Модели

`User`, `Student`, `Teacher`, `Subject`, `Group`, `ScheduleEntry`, `Grade`,
`Request`, `Announcement`, `Notification`, `Session`, `AuditEvent` — ядро
деканата. Расширения под требования BRIEF v2 (верификация, регистрация,
«болею», расписание преподавателей):

| Модель | Зачем |
| --- | --- |
| `IdentityRegistry` | синтетический реестр студбилетов для мок-сверки (замена справки из «системы университета») |
| `StudentVerification` | заявка на верификацию: фото → мок-распознавание → сверка → решение сотрудника |
| `OAuthAccount` | привязка учётной записи к VK ID / MAX / Telegram |
| `OAuthIntent` | эмуляция согласия OAuth-провайдера (одноразовый `state`) |
| `SickLeave` | статус «болею»: период + опциональная справка |
| `OfficeHour` | консультации и часы приёма преподавателя |

Полное описание полей, связей и индексов — в `prisma/schema.prisma` (источник истины).

Ключевые решения по FK:
- `Student.userId` / `Teacher.userId` → `User` с `onDelete: Restrict`:
  удаление пользователя не должно каскадом уносить оценки и заявки.
- `ScheduleEntry.subjectId` / `teacherId`, `Grade.subjectId` → `Restrict`:
  справочники защищены от удаления, пока на них ссылается учёба.
- `ScheduleEntry.groupId`, `Grade.studentId`, `Request.studentId` → `Cascade`:
  удаление группы/студента уносит их зависимые записи учёты.
- `StudentVerification.studentId` → `Cascade` (заявка — данные студента),
  `reviewerId` → `SetNull` (решение сохраняется, если проверяющий удалён).
- `OAuthAccount.userId` → `Cascade`: привязки живут вместе с учётной записью.
- `IdentityRegistry.groupId` → `Restrict`: группу нельзя удалить, пока в реестре
  есть её студбилеты.
- `Session`, `Notification`, `SickLeave`, `OfficeHour` → `Cascade` от владельца.
- `OAuthIntent` не имеет FK: `state` создаётся до появления пользователя.

Индексы под реальные выборки: `StudentVerification(status, submittedAt)`
(очередь на проверку), `SickLeave(studentId, dateFrom)` и `(dateFrom, dateTo)`
(«кто болеет сегодня»), `OfficeHour(teacherId, weekday)` (расписание
преподавателя), `OAuthIntent(expiresAt)` (чистка истёкших согласий).

## Сидер

`prisma/seed.ts` пишет в БД данные, сгенерированные чистой функцией
`buildSeedData()` из `src/seed-data.ts` (детерминированный PRNG, без обращений
к БД — поэтому инварианты проверяются тестами без PostgreSQL).

Состав: 8 институтов УдГУ, 8 групп, 80 дисциплин, 16 преподавателей,
4 студента + staff1 + admin1; расписание на 2 недели вперёд (5-6 пар в будний
день, включая переносы `MOVED` и отмены `CANCELLED`); оценки за 2 семестра
(у student1 — один незачёт); заявки, объявления, уведомления, аудит.

Дополнительно (BRIEF v2): реестр студбилетов (4 студента + 2 незарегистрированные
карточки), 4 заявки на верификацию (`VERIFIED` / `PENDING` / `REJECTED`),
2 OAuth-привязки (VK ID и Telegram) и 2 эмуляции согласия, 2 статуса «болею»
(один активный на сегодня), 13 консультаций и часов приёма у 6 преподавателей.

Пути к фото студбилетов в заявках на верификацию — фикстуры приватного
хранилища (`id-cards/<studentId>/<uuid>.jpg`); файлов на диске сидер не создаёт.
Формат пути задаёт `@udgu/core` (`idCardPhotoRelativePath`), чтобы сидер и
рабочий код не разошлись.

Пароль всех тестовых аккаунтов — argon2id-хеш от демо-пароля `aJMSwSxV_859b7A5`
(единый источник — `packages/ui/src/demo-credentials.ts`; фикстура сидера, в
продакшене пароли задаются только через окружение).

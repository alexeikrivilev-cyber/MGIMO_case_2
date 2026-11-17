#!/usr/bin/env bash
# Сброс схемы БД без `prisma migrate reset` (в Prisma 7 он заблокирован
# гардом согласия): чистая SQL-очистка через docker exec, затем
# migrate deploy + seed. Пароли не хранятся — только переменные окружения.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-horizon-db}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-horizon}"

echo "Очистка схемы ${DB_NAME} в контейнере ${DB_CONTAINER}..."
docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Применение миграций..."
npm run db:deploy

echo "Засев базы..."
npm run db:seed

echo "Готово."

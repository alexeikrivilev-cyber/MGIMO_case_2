# Лог процесса — proj-3311

Хронология работы. Используется для описания процесса создания (критерий 2 кейса).

## 2026-11-16
- 16:10 — Подключение проекта, настройка изолированного workspace.
- 16:11 — Обсуждение состояния: пустой проект, фаза Discovery.

## 2026-11-17
- 13:23 — Получен кейс «Цифровой деканат будущего» (сохранён в `docs/CASE.md`). Задача: автономно вести проект до 28 ноября.
- 13:30 — Приняты решения по стеку (Next.js 15 + TypeScript + Tailwind + Prisma/PostgreSQL; auth — своя сессионная система на argon2id; MCP-сервер — отдельный Node-сервис). Зафиксировано в `docs/ARCHITECTURE.md`, план — в `docs/PLAN.md`.
- Дальше — скаффолд монорепо воркером OpenCode.

## 2026-11-17
- 13:28 — Уточнение от владельца: убран план по дням, работа без остановок, внутренний дедлайн — 4 дня (21.11). План переписан по приоритетам (docs/PLAN.md).
- 13:40 — Скаффолд монорепо (OpenCode): npm workspaces; `apps/web` — Next.js 15 (App Router) + Tailwind CSS 4, каркас (корневой layout, `/`, `/login`); `packages/db` — Prisma 7 + PostgreSQL 16, схема по ARCHITECTURE.md §3 (User, Student, Teacher, Subject, Group, ScheduleEntry, Grade, Request, Announcement, Notification, Session, AuditEvent), миграция и сидер с вымышленными данными (4 студента, 4 преподавателя, 8 предметов, расписание на 2 недели с MOVED/CANCELLED, оценки за 2 семестра, заявки, объявления, уведомления); `packages/core` — заготовка; docker-compose с db. Prisma 7: ESM, `prisma-client` генератор, драйвер-адаптер `@prisma/adapter-pg`, конфиг в `prisma.config.ts`. Пароли — argon2id (@node-rs/argon2). Настроены `docs/agents` (локальный markdown-трекер). Проверено: install → migrate → seed → build.
---

## Воркеры (очередь docs/WORKERS.md + docs/workers/)
- W1 скаффолд — ГОТОВО (ветка feat/monorepo-scaffold, смерджена). Next.js 15 + Prisma 7 + postgres:16; 148 пар на 2 недели, 4 студента, оценки, заявки, объявления, уведомления; чистый клон → install → build → migrate → seed проверены.
- W-UI дизайн-токены — ГОТОВО (commit 15a3127): 134 токена, светлая/тёмная тема, контраст WCAG AA проверен скриптом (danger-hover заменён на red-700 после проверки 3.76:1).
- W2 auth + профиль — в работе.

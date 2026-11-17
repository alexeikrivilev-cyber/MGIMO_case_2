# syntax=docker/dockerfile:1

# --- Зависимости и сборка ---
FROM node:24-alpine AS builder
WORKDIR /app

# argon2 — нативный модуль: на Alpine могут понадобиться инструменты сборки
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/core/tsconfig.json packages/core/
COPY packages/ui/tsconfig.json packages/ui/
COPY packages/db/tsconfig.json packages/db/
COPY packages/core/src packages/core/src/
COPY packages/ui/src packages/ui/src/
COPY packages/ui/tokens.css packages/ui/tokens.css
COPY packages/db/prisma packages/db/prisma/
COPY packages/db/prisma.config.ts packages/db/
COPY packages/db/src packages/db/src/
COPY apps/web apps/web/

RUN npm run db:generate -w @horizon/db
RUN npm run build -w @horizon/web

# --- Рантайм ---
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next standalone сохраняет структуру монорепо: server.js лежит в apps/web/
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]

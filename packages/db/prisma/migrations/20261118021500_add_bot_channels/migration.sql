-- Каналы доступа (BRIEF v3): ядро ботов Telegram / VK / MAX.
-- BotLinkCode — одноразовый код привязки канала к учётной записи (/link),
-- ChannelDelivery — outbox доставки уведомлений в каналы пользователя.
-- Идентичность канала — существующая OAuthAccount, вторая сторона
-- идентичностей не создаётся.
-- CreateEnum
CREATE TYPE "ChannelDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DEMO', 'FAILED');

-- CreateTable
CREATE TABLE "bot_link_codes" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider",
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "channel_deliveries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ChannelDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "channel_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_link_codes_expiresAt_idx" ON "bot_link_codes"("expiresAt");

-- CreateIndex
CREATE INDEX "channel_deliveries_userId_createdAt_idx" ON "channel_deliveries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_deliveries_status_idx" ON "channel_deliveries"("status");

-- AddForeignKey
ALTER TABLE "bot_link_codes" ADD CONSTRAINT "bot_link_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

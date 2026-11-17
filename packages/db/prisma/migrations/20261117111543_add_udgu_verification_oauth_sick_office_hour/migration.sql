-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('VK_ID', 'MAX', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "OfficeHourType" AS ENUM ('CONSULTATION', 'RECEPTION', 'EXTRA_CLASS');

-- CreateTable
CREATE TABLE "identity_registry" (
    "id" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "groupId" TEXT NOT NULL,
    "faculty" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "course" INTEGER NOT NULL,
    "issuedAt" DATE NOT NULL,

    CONSTRAINT "identity_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_verifications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "idCardPhotoPath" TEXT NOT NULL,
    "recognizedLastName" TEXT NOT NULL,
    "recognizedFirstName" TEXT NOT NULL,
    "recognizedGroupName" TEXT NOT NULL,
    "recognizedCardNumber" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "reviewerId" TEXT,
    "reviewComment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_intents" (
    "state" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "login" TEXT,
    "fullName" TEXT,
    "groupName" TEXT,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_intents_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "sick_leaves" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "reason" TEXT,
    "attachmentPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sick_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_hours" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "type" "OfficeHourType" NOT NULL,
    "note" TEXT,

    CONSTRAINT "office_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_registry_cardNumber_key" ON "identity_registry"("cardNumber");

-- CreateIndex
CREATE INDEX "identity_registry_groupId_idx" ON "identity_registry"("groupId");

-- CreateIndex
CREATE INDEX "identity_registry_lastName_idx" ON "identity_registry"("lastName");

-- CreateIndex
CREATE UNIQUE INDEX "student_verifications_studentId_key" ON "student_verifications"("studentId");

-- CreateIndex
CREATE INDEX "student_verifications_status_submittedAt_idx" ON "student_verifications"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_providerAccountId_key" ON "oauth_accounts"("providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_userId_provider_key" ON "oauth_accounts"("userId", "provider");

-- CreateIndex
CREATE INDEX "oauth_intents_expiresAt_idx" ON "oauth_intents"("expiresAt");

-- CreateIndex
CREATE INDEX "sick_leaves_studentId_dateFrom_idx" ON "sick_leaves"("studentId", "dateFrom");

-- CreateIndex
CREATE INDEX "sick_leaves_dateFrom_dateTo_idx" ON "sick_leaves"("dateFrom", "dateTo");

-- CreateIndex
CREATE INDEX "office_hours_teacherId_weekday_idx" ON "office_hours"("teacherId", "weekday");

-- AddForeignKey
ALTER TABLE "identity_registry" ADD CONSTRAINT "identity_registry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_verifications" ADD CONSTRAINT "student_verifications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_verifications" ADD CONSTRAINT "student_verifications_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_hours" ADD CONSTRAINT "office_hours_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

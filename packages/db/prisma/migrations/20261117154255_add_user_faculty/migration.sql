/*
  Warnings:

  - You are about to drop the `staff_profiles` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "staff_profiles" DROP CONSTRAINT "staff_profiles_userId_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "faculty" TEXT;

-- DropTable
DROP TABLE "staff_profiles";

-- CreateIndex
CREATE INDEX "users_faculty_idx" ON "users"("faculty");

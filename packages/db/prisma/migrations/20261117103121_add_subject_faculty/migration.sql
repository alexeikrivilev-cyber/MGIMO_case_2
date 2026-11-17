/*
  Warnings:

  - Added the required column `faculty` to the `subjects` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "faculty" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "subjects_faculty_idx" ON "subjects"("faculty");

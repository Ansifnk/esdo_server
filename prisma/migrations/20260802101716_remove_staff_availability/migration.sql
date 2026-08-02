/*
  Warnings:

  - You are about to drop the `StaffAvailability` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StaffScheduleOverride` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `joiningDate` on table `Staff` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "StaffAvailability" DROP CONSTRAINT "StaffAvailability_staffId_fkey";

-- DropForeignKey
ALTER TABLE "StaffScheduleOverride" DROP CONSTRAINT "StaffScheduleOverride_staffId_fkey";

-- AlterTable
ALTER TABLE "Staff" ALTER COLUMN "joiningDate" SET NOT NULL;

-- DropTable
DROP TABLE "StaffAvailability";

-- DropTable
DROP TABLE "StaffScheduleOverride";

-- DropEnum
DROP TYPE "ScheduleOverrideType";

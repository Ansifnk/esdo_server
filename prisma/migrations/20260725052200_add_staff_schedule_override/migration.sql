-- CreateEnum
CREATE TYPE "ScheduleOverrideType" AS ENUM ('LEAVE', 'CUSTOM_HOURS');

-- CreateEnum
CREATE TYPE "StaffType" AS ENUM ('STYLIST', 'MANAGER', 'RECEPTIONIST');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "type" "StaffType" NOT NULL DEFAULT 'STYLIST';

-- AlterTable
ALTER TABLE "StaffAvailability" ADD COLUMN     "endDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "startDate" TEXT NOT NULL DEFAULT '',
DROP COLUMN    "day";

-- CreateTable
CREATE TABLE "StaffScheduleOverride" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" "ScheduleOverrideType" NOT NULL DEFAULT 'LEAVE',
    "startTime" TEXT,
    "endTime" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StaffScheduleOverride" ADD CONSTRAINT "StaffScheduleOverride_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

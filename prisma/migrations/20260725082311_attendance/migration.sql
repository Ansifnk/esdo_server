-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'LATE');

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "saloonId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkIn" TEXT DEFAULT '',
    "checkOut" TEXT DEFAULT '',
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAttendance_staffId_date_idx" ON "StaffAttendance"("staffId", "date");

-- CreateIndex
CREATE INDEX "StaffAttendance_saloonId_date_idx" ON "StaffAttendance"("saloonId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_staffId_date_key" ON "StaffAttendance"("staffId", "date");

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_saloonId_fkey" FOREIGN KEY ("saloonId") REFERENCES "Saloon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ADMIN', 'WEBSITE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'WEBSITE';

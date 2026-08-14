-- CreateEnum
CREATE TYPE "StylistCategory" AS ENUM ('PRIME', 'GOLD', 'SILVER');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "stylistCategory" "StylistCategory" NOT NULL DEFAULT 'PRIME';

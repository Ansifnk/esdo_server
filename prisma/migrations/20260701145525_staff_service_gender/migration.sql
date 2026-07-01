-- CreateEnum
CREATE TYPE "ServiceGender" AS ENUM ('MALE', 'FEMALE', 'UNI');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "serviceGender" "ServiceGender" NOT NULL DEFAULT 'UNI';

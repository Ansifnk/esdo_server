-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '';

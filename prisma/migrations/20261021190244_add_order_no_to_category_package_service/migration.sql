-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "orderNo" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "orderNo" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "orderNo" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubCategory" ADD COLUMN     "orderNo" INTEGER NOT NULL DEFAULT 0;

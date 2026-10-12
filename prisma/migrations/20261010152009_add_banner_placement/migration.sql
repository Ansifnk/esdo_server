-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('HERO', 'AFTER_SERVICES', 'AFTER_PACKAGES');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "linkUrl" TEXT DEFAULT '',
ADD COLUMN     "mobileBannerImage" TEXT DEFAULT '',
ADD COLUMN     "placement" "BannerPlacement" NOT NULL DEFAULT 'HERO';

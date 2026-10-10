-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardTxType" AS ENUM ('SPEND_EARN', 'REFERRAL_EARN', 'REDEMPTION', 'REFUND_REVERSAL', 'EXPIRY', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardTxStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVERSED', 'FULLY_CONSUMED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT;

-- CreateTable
CREATE TABLE "RewardSetting" (
    "id" TEXT NOT NULL,
    "isSpendRewardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "spendAmountPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "coinsEarnedPerUnit" INTEGER NOT NULL DEFAULT 1,
    "coinRedemptionValue" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "minRedemptionCoins" INTEGER NOT NULL DEFAULT 100,
    "maxRedemptionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "allowCombineWithCoupon" BOOLEAN NOT NULL DEFAULT true,
    "spendCoinExpiryMonths" INTEGER NOT NULL DEFAULT 12,
    "isReferralEnabled" BOOLEAN NOT NULL DEFAULT true,
    "referredUserDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 125.0,
    "referredUserMinOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 500.0,
    "referredUserDiscountExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "referralCoinExpiryMonths" INTEGER NOT NULL DEFAULT 12,
    "defaultReferralCoins" INTEGER NOT NULL DEFAULT 200,
    "shareMessageTemplate" TEXT NOT NULL DEFAULT 'Sharing something I personally love ❤️ Es_Do has been amazing for salon & wellness services. Use my referral code {code} to get ₹{discount} OFF on your first booking. Visit now: {url}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRewardSlab" (
    "id" TEXT NOT NULL,
    "referralCount" INTEGER NOT NULL,
    "coinsEarned" INTEGER NOT NULL,
    "hasMilestoneReward" BOOLEAN NOT NULL DEFAULT false,
    "milestoneTitle" TEXT,
    "milestoneType" TEXT,
    "milestoneValue" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralRewardSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredCustomerId" TEXT NOT NULL,
    "referralCodeUsed" TEXT NOT NULL,
    "referralNumber" INTEGER NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "milestoneUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "milestoneTitle" TEXT,
    "qualifyingBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "RewardTxType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "remainingCoins" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "status" "RewardTxStatus" NOT NULL DEFAULT 'ACTIVE',
    "bookingId" TEXT,
    "referralId" TEXT,
    "notes" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRewardSlab_referralCount_key" ON "ReferralRewardSlab"("referralCount");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredCustomerId_key" ON "Referral"("referredCustomerId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "RewardTransaction_customerId_idx" ON "RewardTransaction"("customerId");

-- CreateIndex
CREATE INDEX "RewardTransaction_expiresAt_idx" ON "RewardTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "RewardTransaction_status_idx" ON "RewardTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_qualifyingBookingId_fkey" FOREIGN KEY ("qualifyingBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTransaction" ADD CONSTRAINT "RewardTransaction_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;


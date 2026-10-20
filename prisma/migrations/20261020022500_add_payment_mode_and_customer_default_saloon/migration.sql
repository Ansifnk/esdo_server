-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('UPI', 'CARD', 'CASH', 'BANK_TRANSFER');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "defaultSaloonId" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "paymentMode" "PaymentMode" DEFAULT 'CASH';

-- CreateIndex
CREATE INDEX "Customer_defaultSaloonId_idx" ON "Customer"("defaultSaloonId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_defaultSaloonId_fkey" FOREIGN KEY ("defaultSaloonId") REFERENCES "Saloon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

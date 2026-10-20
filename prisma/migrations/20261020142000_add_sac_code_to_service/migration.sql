-- AlterTable
ALTER TABLE "Service" ADD COLUMN "sacCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Service_sacCode_key" ON "Service"("sacCode");

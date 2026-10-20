-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "birthDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT DEFAULT 'Home',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT DEFAULT '',
    "state" TEXT DEFAULT '',
    "pincode" TEXT DEFAULT '',
    "landmark" TEXT DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Address_customerId_idx" ON "Address"("customerId");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

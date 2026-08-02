-- CreateTable
CREATE TABLE "StaffSlot" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isWorking" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffSlot_staffId_date_idx" ON "StaffSlot"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSlot_staffId_date_key" ON "StaffSlot"("staffId", "date");

-- AddForeignKey
ALTER TABLE "StaffSlot" ADD CONSTRAINT "StaffSlot_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

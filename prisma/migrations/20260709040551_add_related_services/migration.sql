-- CreateTable
CREATE TABLE "_ServiceToService" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ServiceToService_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ServiceToService_B_index" ON "_ServiceToService"("B");

-- AddForeignKey
ALTER TABLE "_ServiceToService" ADD CONSTRAINT "_ServiceToService_A_fkey" FOREIGN KEY ("A") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServiceToService" ADD CONSTRAINT "_ServiceToService_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "_CustomerToOffer" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CustomerToOffer_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CustomerToOffer_B_index" ON "_CustomerToOffer"("B");

-- AddForeignKey
ALTER TABLE "_CustomerToOffer" ADD CONSTRAINT "_CustomerToOffer_A_fkey" FOREIGN KEY ("A") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CustomerToOffer" ADD CONSTRAINT "_CustomerToOffer_B_fkey" FOREIGN KEY ("B") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

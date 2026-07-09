-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "discountPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "primaryImage" TEXT NOT NULL DEFAULT '',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "saloonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PackageToService" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PackageToService_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PackageToService_B_index" ON "_PackageToService"("B");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_saloonId_fkey" FOREIGN KEY ("saloonId") REFERENCES "Saloon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PackageToService" ADD CONSTRAINT "_PackageToService_A_fkey" FOREIGN KEY ("A") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PackageToService" ADD CONSTRAINT "_PackageToService_B_fkey" FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_gender_key" ON "Category"("name", "gender");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategory_name_categoryId_key" ON "SubCategory"("name", "categoryId");

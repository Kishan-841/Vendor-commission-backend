-- DropIndex
DROP INDEX "sales_uploads_month_key";

-- AlterTable
ALTER TABLE "sales_uploads" ADD COLUMN     "salesType" "ZoneType";

-- CreateIndex
CREATE UNIQUE INDEX "sales_uploads_month_salesType_key" ON "sales_uploads"("month", "salesType");


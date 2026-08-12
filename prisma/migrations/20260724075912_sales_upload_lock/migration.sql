-- DropIndex
DROP INDEX "sales_uploads_month_idx";

-- AlterTable
ALTER TABLE "sales_uploads" ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'UPLOADED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "sales_uploads_month_key" ON "sales_uploads"("month");


-- CreateTable
CREATE TABLE "sales_uploads" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "salesType" "ZoneType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columns" JSONB,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rows" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "zoneName" TEXT NOT NULL,
    "planAmount" DECIMAL(18,2) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "sales_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_uploads_month_idx" ON "sales_uploads"("month");

-- CreateIndex
CREATE INDEX "sales_rows_uploadId_idx" ON "sales_rows"("uploadId");

-- AddForeignKey
ALTER TABLE "sales_uploads" ADD CONSTRAINT "sales_uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rows" ADD CONSTRAINT "sales_rows_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "sales_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

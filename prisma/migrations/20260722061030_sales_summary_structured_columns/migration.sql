/*
  Warnings:

  - You are about to drop the column `data` on the `sales_rows` table. All the data in the column will be lost.
  - You are about to drop the column `salesType` on the `sales_uploads` table. All the data in the column will be lost.
  - Added the required column `salesType` to the `sales_rows` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sales_rows" DROP COLUMN "data",
ADD COLUMN     "activationType" TEXT,
ADD COLUMN     "actualBillAmount" DECIMAL(18,2),
ADD COLUMN     "address" TEXT,
ADD COLUMN     "adjustedAmount" DECIMAL(18,2),
ADD COLUMN     "billAmount" DECIMAL(18,2),
ADD COLUMN     "billDate" TIMESTAMP(3),
ADD COLUMN     "billNo" TEXT,
ADD COLUMN     "buildingName" TEXT,
ADD COLUMN     "cgst" DECIMAL(18,2),
ADD COLUMN     "clientGst" TEXT,
ADD COLUMN     "companyGstNo" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "extra" JSONB,
ADD COLUMN     "franchiseeName" TEXT,
ADD COLUMN     "inquiryRemarks" TEXT,
ADD COLUMN     "mobileNo" TEXT,
ADD COLUMN     "modeOfRenew" TEXT,
ADD COLUMN     "onlineTransactionNo" TEXT,
ADD COLUMN     "operatorName" TEXT,
ADD COLUMN     "pinCode" TEXT,
ADD COLUMN     "planName" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "salesPerson" TEXT,
ADD COLUMN     "salesType" "ZoneType" NOT NULL,
ADD COLUMN     "sgst" DECIMAL(18,2),
ADD COLUMN     "site" TEXT,
ADD COLUMN     "userCurrentStatus" TEXT,
ADD COLUMN     "userName" TEXT,
ADD COLUMN     "userPendingAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "sales_uploads" DROP COLUMN "salesType";

-- CreateIndex
CREATE INDEX "sales_rows_zoneName_idx" ON "sales_rows"("zoneName");

-- CreateIndex
CREATE INDEX "sales_rows_billNo_idx" ON "sales_rows"("billNo");

-- CreateIndex
CREATE INDEX "sales_rows_salesType_idx" ON "sales_rows"("salesType");

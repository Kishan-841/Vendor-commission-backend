-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "fixedPayAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "commission_calculations" ADD COLUMN     "fixedPayAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "fixedPayAmount" DECIMAL(18,2),
ADD COLUMN     "fixedPayEnabled" BOOLEAN NOT NULL DEFAULT false;

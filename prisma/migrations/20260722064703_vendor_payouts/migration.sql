-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER');

-- AlterTable
ALTER TABLE "commission_calculations" ADD COLUMN     "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "payout_payments" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "paymentReference" TEXT,
    "notes" TEXT,
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_payments_calculationId_idx" ON "payout_payments"("calculationId");

-- CreateIndex
CREATE INDEX "payout_payments_paymentDate_idx" ON "payout_payments"("paymentDate");

-- CreateIndex
CREATE INDEX "commission_calculations_paymentStatus_idx" ON "commission_calculations"("paymentStatus");

-- AddForeignKey
ALTER TABLE "payout_payments" ADD CONSTRAINT "payout_payments_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "commission_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_payments" ADD CONSTRAINT "payout_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

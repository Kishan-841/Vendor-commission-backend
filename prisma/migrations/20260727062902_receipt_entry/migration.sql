-- AlterTable
ALTER TABLE "payout_payments" ADD COLUMN     "attachmentPath" TEXT,
ADD COLUMN     "receiptNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payout_payments_receiptNumber_key" ON "payout_payments"("receiptNumber");


-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "ip" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

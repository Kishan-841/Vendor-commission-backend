-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'FINANCE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CalculationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'FINANCE',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "vendorType" "VendorType" NOT NULL,
    "companyName" TEXT,
    "vendorName" TEXT NOT NULL,
    "address" TEXT,
    "mobileNumber" TEXT,
    "email" TEXT,
    "panNumber" TEXT,
    "gstNumber" TEXT,
    "agrApplicable" BOOLEAN NOT NULL DEFAULT false,
    "agrPercentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tdsPercentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_details" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "bankName" TEXT,
    "accountHolder" TEXT,
    "accountNumber" TEXT,
    "ifscCode" TEXT,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bank_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_uploads" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columns" JSONB,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "uploadId" TEXT,
    "name" TEXT NOT NULL,
    "zoneData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_calculations" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "billingPeriod" TEXT,
    "totalSales" DECIMAL(18,2) NOT NULL,
    "agrApplicable" BOOLEAN NOT NULL DEFAULT false,
    "agrPercentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "gstPercentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tdsPercentage" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "agrAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "salesAfterAgr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossCommission" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "finalPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "CalculationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_zone_breakdowns" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "zoneId" TEXT,
    "zoneName" TEXT NOT NULL,
    "commissionPercentage" DECIMAL(7,4) NOT NULL,
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "commissionAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_zone_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "remarks" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "grossCommission" DECIMAL(18,2) NOT NULL,
    "gstAmount" DECIMAL(18,2) NOT NULL,
    "tdsAmount" DECIMAL(18,2) NOT NULL,
    "finalPayable" DECIMAL(18,2) NOT NULL,
    "pdfPath" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "commissionPercentage" DECIMAL(7,4),
    "baseAmount" DECIMAL(18,2),
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_vendorName_idx" ON "vendors"("vendorName");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bank_details_vendorId_key" ON "vendor_bank_details"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_documents_vendorId_idx" ON "vendor_documents"("vendorId");

-- CreateIndex
CREATE INDEX "zone_uploads_vendorId_idx" ON "zone_uploads"("vendorId");

-- CreateIndex
CREATE INDEX "zones_vendorId_idx" ON "zones"("vendorId");

-- CreateIndex
CREATE INDEX "zones_name_idx" ON "zones"("name");

-- CreateIndex
CREATE INDEX "commission_calculations_vendorId_idx" ON "commission_calculations"("vendorId");

-- CreateIndex
CREATE INDEX "commission_calculations_status_idx" ON "commission_calculations"("status");

-- CreateIndex
CREATE INDEX "commission_calculations_month_idx" ON "commission_calculations"("month");

-- CreateIndex
CREATE INDEX "commission_zone_breakdowns_calculationId_idx" ON "commission_zone_breakdowns"("calculationId");

-- CreateIndex
CREATE INDEX "approvals_calculationId_idx" ON "approvals"("calculationId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_billNumber_key" ON "bills"("billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bills_calculationId_key" ON "bills"("calculationId");

-- CreateIndex
CREATE INDEX "bills_vendorId_idx" ON "bills"("vendorId");

-- CreateIndex
CREATE INDEX "bill_items_billId_idx" ON "bill_items"("billId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_details" ADD CONSTRAINT "vendor_bank_details_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_uploads" ADD CONSTRAINT "zone_uploads_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_uploads" ADD CONSTRAINT "zone_uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "zone_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_calculations" ADD CONSTRAINT "commission_calculations_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_calculations" ADD CONSTRAINT "commission_calculations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_zone_breakdowns" ADD CONSTRAINT "commission_zone_breakdowns_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "commission_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_zone_breakdowns" ADD CONSTRAINT "commission_zone_breakdowns_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "commission_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "commission_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

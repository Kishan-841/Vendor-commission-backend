/*
  Warnings:

  - You are about to drop the column `vendorId` on the `zone_uploads` table. All the data in the column will be lost.
  - You are about to drop the column `vendorId` on the `zones` table. All the data in the column will be lost.
  - Added the required column `zoneType` to the `zone_uploads` table without a default value. This is not possible if the table is not empty.
  - Added the required column `zoneType` to the `zones` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('NEW', 'RENEWAL');

-- DropForeignKey
ALTER TABLE "zone_uploads" DROP CONSTRAINT "zone_uploads_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "zones" DROP CONSTRAINT "zones_vendorId_fkey";

-- DropIndex
DROP INDEX "zone_uploads_vendorId_idx";

-- DropIndex
DROP INDEX "zones_vendorId_idx";

-- AlterTable
ALTER TABLE "zone_uploads" DROP COLUMN "vendorId",
ADD COLUMN     "zoneType" "ZoneType" NOT NULL;

-- AlterTable
ALTER TABLE "zones" DROP COLUMN "vendorId",
ADD COLUMN     "zoneType" "ZoneType" NOT NULL;

-- CreateTable
CREATE TABLE "_VendorZones" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VendorZones_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_VendorZones_B_index" ON "_VendorZones"("B");

-- CreateIndex
CREATE INDEX "zone_uploads_zoneType_idx" ON "zone_uploads"("zoneType");

-- CreateIndex
CREATE INDEX "zones_zoneType_idx" ON "zones"("zoneType");

-- AddForeignKey
ALTER TABLE "_VendorZones" ADD CONSTRAINT "_VendorZones_A_fkey" FOREIGN KEY ("A") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VendorZones" ADD CONSTRAINT "_VendorZones_B_fkey" FOREIGN KEY ("B") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

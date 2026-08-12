-- Zone becomes a plain master (drop type); ZoneUpload drops type.
-- Vendor↔Zone implicit m-n replaced by explicit vendor_zones (type + %).

-- Drop implicit many-to-many join table
DROP TABLE IF EXISTS "_VendorZones";

-- Drop zoneType from zones and zone_uploads (indexes drop with the columns)
DROP INDEX IF EXISTS "zones_zoneType_idx";
ALTER TABLE "zones" DROP COLUMN IF EXISTS "zoneType";

DROP INDEX IF EXISTS "zone_uploads_zoneType_idx";
ALTER TABLE "zone_uploads" DROP COLUMN IF EXISTS "zoneType";

-- Snapshot the type on breakdowns (nullable)
ALTER TABLE "commission_zone_breakdowns" ADD COLUMN "zoneType" "ZoneType";

-- Explicit assignment join
CREATE TABLE "vendor_zones" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "zoneType" "ZoneType" NOT NULL,
    "commissionPercentage" DECIMAL(7,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_zones_vendorId_zoneId_zoneType_key" ON "vendor_zones"("vendorId", "zoneId", "zoneType");
CREATE INDEX "vendor_zones_vendorId_idx" ON "vendor_zones"("vendorId");
CREATE INDEX "vendor_zones_zoneId_idx" ON "vendor_zones"("zoneId");

ALTER TABLE "vendor_zones" ADD CONSTRAINT "vendor_zones_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_zones" ADD CONSTRAINT "vendor_zones_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

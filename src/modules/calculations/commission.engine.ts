// ─────────────────────────────────────────────────────────────────────────
// Commission calculation engine (pure, no I/O)
//
// This is the single source of truth for the money math. Keeping it pure and
// isolated means it can be unit-tested and audited without a database, and any
// change to the business rule happens in exactly one place.
//
// Worked example from the PRD (kept as the canonical test case):
//   Sales        = 100000
//   AGR 8%       ->  AGR amount 8000,  sales after AGR = 92000
//   Zone A 10%   ->  92000 × 10% = 9200
//   Zone B  5%   ->  92000 ×  5% = 4600
//   Gross        = 13800
//   GST 18%      ->  +2484
//   TDS  2%      ->  -276   (on gross commission, not on GST-inclusive amount)
//   Final        = 13800 + 2484 - 276 = 16008
//
// Fixed Vendor Pay joins the base BEFORE taxes: GST and TDS are computed on
// (gross commission + fixed pay), so Final = (gross + fixed) + GST - TDS.
//
// The final payable is rounded off to the nearest whole rupee (invoice
// practice); component amounts stay paise-precise, so the round-off is always
// derivable as final - (gross + fixedPay + gst - tds).
// ─────────────────────────────────────────────────────────────────────────

export interface ZoneCommissionInput {
  zoneId?: string;
  zoneName: string;
  zoneType?: 'NEW' | 'RENEWAL';
  commissionPercentage: number; // 0–100
}

export interface CommissionInput {
  totalSales: number;
  agrApplicable: boolean;
  agrPercentage: number; // 0–100
  gstPercentage: number; // 0–100 (0 when the vendor has no GST)
  tdsPercentage: number; // 0–100
  zones: ZoneCommissionInput[];
  fixedPayAmount?: number; // Fixed Vendor Pay, added on top of performance pay
}

export interface ZoneBreakdown {
  zoneId?: string;
  zoneName: string;
  zoneType?: 'NEW' | 'RENEWAL';
  commissionPercentage: number;
  baseAmount: number; // the sales-after-AGR base this % was applied to
  commissionAmount: number;
}

export interface CommissionResult {
  agrAmount: number;
  salesAfterAgr: number;
  breakdowns: ZoneBreakdown[];
  grossCommission: number;
  gstAmount: number;
  tdsAmount: number;
  fixedPayAmount: number; // 0 unless the vendor has Fixed Vendor Pay enabled
  finalPayable: number; // (gross + fixedPay) + gst - tds, rounded to the nearest rupee
}

// Round to 2 decimals (paise). Uses a tiny epsilon nudge so values like
// 2483.9999999 from floating point land on the intended 2484.00.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const pct = (amount: number, percentage: number) => round2((amount * percentage) / 100);

// Derive the round-off a stored calculation carries: finalPayable is rounded
// to the whole rupee while components stay paise-precise. Single source of
// truth for every surface that displays a "Round off" line.
export function deriveRoundOff(parts: {
  grossCommission: number;
  fixedPayAmount: number;
  gstAmount: number;
  tdsAmount: number;
  finalPayable: number;
}): number {
  return round2(
    parts.finalPayable -
      (parts.grossCommission + parts.fixedPayAmount + parts.gstAmount - parts.tdsAmount),
  );
}

// Excel-driven variant: each zone carries its OWN sales (its aggregated plan
// amount). AGR is applied per zone, then that zone's % — summed into the
// vendor's gross. GST/TDS/final work exactly as in computeCommission.
export interface ZoneSalesInput {
  zoneId?: string;
  zoneName: string;
  zoneType?: 'NEW' | 'RENEWAL';
  commissionPercentage: number;
  zoneSales: number;
}

export interface PerZoneCommissionInput {
  agrApplicable: boolean;
  agrPercentage: number;
  gstPercentage: number;
  tdsPercentage: number;
  zones: ZoneSalesInput[];
  fixedPayAmount?: number; // Fixed Vendor Pay, added on top of performance pay
}

export function computeCommissionFromZoneSales(
  input: PerZoneCommissionInput,
): CommissionResult & { totalSales: number } {
  let totalSales = 0;
  let agrAmount = 0;
  let salesAfterAgr = 0;
  let grossCommission = 0;

  const breakdowns: ZoneBreakdown[] = input.zones.map((z) => {
    const zoneSales = round2(z.zoneSales);
    const zoneAgr = input.agrApplicable ? pct(zoneSales, input.agrPercentage) : 0;
    const afterAgr = round2(zoneSales - zoneAgr);
    const commission = pct(afterAgr, z.commissionPercentage);
    totalSales += zoneSales;
    agrAmount += zoneAgr;
    salesAfterAgr += afterAgr;
    grossCommission += commission;
    return {
      zoneId: z.zoneId,
      zoneName: z.zoneName,
      zoneType: z.zoneType,
      commissionPercentage: z.commissionPercentage,
      baseAmount: afterAgr,
      commissionAmount: commission,
    };
  });

  totalSales = round2(totalSales);
  agrAmount = round2(agrAmount);
  salesAfterAgr = round2(salesAfterAgr);
  grossCommission = round2(grossCommission);
  // Fixed pay joins the base before taxes: GST/TDS apply to gross + fixed pay.
  const fixedPayAmount = round2(input.fixedPayAmount ?? 0);
  const taxBase = round2(grossCommission + fixedPayAmount);
  const gstAmount = pct(taxBase, input.gstPercentage);
  const tdsAmount = pct(taxBase, input.tdsPercentage);
  // Round off to the nearest whole rupee (components stay paise-precise).
  const finalPayable = Math.round(taxBase + gstAmount - tdsAmount);

  return {
    totalSales,
    agrAmount,
    salesAfterAgr,
    breakdowns,
    grossCommission,
    gstAmount,
    tdsAmount,
    fixedPayAmount,
    finalPayable,
  };
}

export function computeCommission(input: CommissionInput): CommissionResult {
  const totalSales = round2(input.totalSales);

  // 1. AGR reduces the sales base before any commission is applied.
  const agrAmount = input.agrApplicable ? pct(totalSales, input.agrPercentage) : 0;
  const salesAfterAgr = round2(totalSales - agrAmount);

  // 2. Each zone earns its percentage of the SAME sales-after-AGR base.
  const breakdowns: ZoneBreakdown[] = input.zones.map((z) => ({
    zoneId: z.zoneId,
    zoneName: z.zoneName,
    zoneType: z.zoneType,
    commissionPercentage: z.commissionPercentage,
    baseAmount: salesAfterAgr,
    commissionAmount: pct(salesAfterAgr, z.commissionPercentage),
  }));

  // 3. Gross commission is the sum across all selected zones.
  const grossCommission = round2(
    breakdowns.reduce((sum, b) => sum + b.commissionAmount, 0),
  );

  // 4. Fixed pay joins the base first; GST is added on top of that base and
  //    TDS is deducted from it: Final = (gross + fixed) + GST - TDS.
  const fixedPayAmount = round2(input.fixedPayAmount ?? 0);
  const taxBase = round2(grossCommission + fixedPayAmount);
  const gstAmount = pct(taxBase, input.gstPercentage);
  const tdsAmount = pct(taxBase, input.tdsPercentage);
  // Round off to the nearest whole rupee (components stay paise-precise).
  const finalPayable = Math.round(taxBase + gstAmount - tdsAmount);

  return {
    agrAmount,
    salesAfterAgr,
    breakdowns,
    grossCommission,
    gstAmount,
    tdsAmount,
    fixedPayAmount,
    finalPayable,
  };
}

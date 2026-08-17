import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const toNum = (d: unknown) => Number(d ?? 0);

export interface ZoneCommissionRow {
  zone: string;
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  commissionPercentage: number; // effective rate = commission / sales × 100
  commissionAmount: number;
}

export interface ZoneCommissionReport {
  month: string;
  rows: ZoneCommissionRow[];
  summary: {
    totalZones: number;
    totalSales: number;
    totalCommission: number;
    totalOrders: number;
    averageCommissionPercentage: number;
  };
}

const SORT_KEYS = new Set([
  'zone',
  'totalSales',
  'totalOrders',
  'commissionPercentage',
  'commissionAmount',
]);

function sortRows(rows: ZoneCommissionRow[], sortBy?: string, sortOrder?: 'asc' | 'desc') {
  if (sortBy && SORT_KEYS.has(sortBy)) {
    const dir = sortOrder === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortBy === 'zone') return a.zone.localeCompare(b.zone) * (sortOrder === 'desc' ? -1 : 1);
      return ((a[sortBy as keyof ZoneCommissionRow] as number) -
        (b[sortBy as keyof ZoneCommissionRow] as number)) * dir;
    });
  }
  // Default: highest commission amount, then zone name ascending.
  return [...rows].sort(
    (a, b) => b.commissionAmount - a.commissionAmount || a.zone.localeCompare(b.zone),
  );
}

// Zone-wise commission for a month. Sales + orders come from the uploaded sheet
// (SalesRow); commission comes from approved calculation zone-breakdowns (same
// source as the dashboard's Zone Performance). Merged per zone (case-insensitive
// name). Commission % is the effective rate (commission ÷ sales).
export async function getZoneCommissionReport(
  month: string,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
): Promise<ZoneCommissionReport> {
  const [salesGroups, commGroups] = await Promise.all([
    prisma.salesRow.groupBy({
      by: ['zoneName'],
      where: { upload: { month } },
      _sum: { planAmount: true },
      _count: { _all: true },
    }),
    prisma.commissionZoneBreakdown.groupBy({
      by: ['zoneName'],
      where: { calculation: { status: 'APPROVED', month } },
      _sum: { commissionAmount: true },
    }),
  ]);

  // Merge both sources by lower-cased zone name.
  const merged = new Map<string, { display: string; sales: number; orders: number; commission: number }>();
  for (const s of salesGroups) {
    merged.set(s.zoneName.toLowerCase(), {
      display: s.zoneName,
      sales: toNum(s._sum.planAmount),
      orders: s._count._all,
      commission: 0,
    });
  }
  for (const c of commGroups) {
    const key = c.zoneName.toLowerCase();
    const cur = merged.get(key);
    if (cur) cur.commission += toNum(c._sum.commissionAmount);
    else merged.set(key, { display: c.zoneName, sales: 0, orders: 0, commission: toNum(c._sum.commissionAmount) });
  }

  const rows: ZoneCommissionRow[] = [...merged.values()].map((v) => ({
    zone: v.display,
    totalSales: v.sales,
    totalOrders: v.orders,
    averageOrderValue: v.orders > 0 ? v.sales / v.orders : 0,
    commissionAmount: v.commission,
    commissionPercentage: v.sales > 0 ? (v.commission / v.sales) * 100 : 0,
  }));

  const sorted = sortRows(rows, sortBy, sortOrder);
  const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commissionAmount, 0);

  return {
    month,
    rows: sorted,
    summary: {
      totalZones: rows.length,
      totalSales,
      totalCommission,
      totalOrders: rows.reduce((s, r) => s + r.totalOrders, 0),
      averageCommissionPercentage: totalSales > 0 ? (totalCommission / totalSales) * 100 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Excel export — single sheet "Zone Commission Summary"
// ---------------------------------------------------------------------------

const CURRENCY_FMT = '"₹"#,##0.00';
const PCT_FMT = '0.00"%"';

export async function buildZoneCommissionWorkbook(
  month: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const report = await getZoneCommissionReport(month);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VCMS';
  const ws = wb.addWorksheet('Zone Commission Summary');
  ws.columns = [
    { header: 'Zone', key: 'zone', width: 26 },
    { header: 'Total Sales Amount', key: 'sales', width: 18 },
    { header: 'Commission %', key: 'pct', width: 14 },
    { header: 'Commission Amount', key: 'commission', width: 18 },
    { header: 'Total Orders', key: 'orders', width: 13 },
    { header: 'Average Order Value', key: 'aov', width: 18 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });

  if (report.rows.length === 0) {
    ws.mergeCells('A2:F2');
    const cell = ws.getCell('A2');
    cell.value = 'No commission data available for the selected month.';
    cell.alignment = { horizontal: 'center' };
    cell.font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    for (const r of report.rows) {
      const row = ws.addRow({
        zone: r.zone,
        sales: r.totalSales,
        pct: r.commissionPercentage,
        commission: r.commissionAmount,
        orders: r.totalOrders,
        aov: r.averageOrderValue,
      });
      row.getCell('sales').numFmt = CURRENCY_FMT;
      row.getCell('commission').numFmt = CURRENCY_FMT;
      row.getCell('aov').numFmt = CURRENCY_FMT;
      row.getCell('pct').numFmt = PCT_FMT;
    }
    // Totals row.
    const totalRow = ws.addRow({
      zone: 'Total',
      sales: report.summary.totalSales,
      pct: report.summary.averageCommissionPercentage,
      commission: report.summary.totalCommission,
      orders: report.summary.totalOrders,
      aov: '',
    });
    totalRow.font = { bold: true };
    totalRow.getCell('sales').numFmt = CURRENCY_FMT;
    totalRow.getCell('commission').numFmt = CURRENCY_FMT;
    totalRow.getCell('pct').numFmt = PCT_FMT;
  }

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, fileName: `Zone_Commission_${month}.xlsx` };
}

// ── Vendor commission report ────────────────────────────────────────────────
// One entry per calculation in the month (any status unless filtered), read
// straight from the stored snapshot — no recomputation. roundOff is derived
// the same way as the calc detail page / bill PDF.

export interface VendorCommissionZoneLine {
  zoneName: string;
  zoneType: string | null;
  commissionPercentage: number;
  baseAmount: number; // sales base the % was applied to (after AGR)
  commissionAmount: number;
}

export interface VendorCommissionRow {
  calculationId: string;
  vendorName: string;
  companyName: string | null;
  status: string;
  totalSales: number;
  agrAmount: number;
  zones: VendorCommissionZoneLine[];
  grossCommission: number;
  fixedPayAmount: number;
  gstAmount: number;
  tdsAmount: number;
  roundOff: number;
  finalPayable: number;
}

type CalcWithRelations = Prisma.CommissionCalculationGetPayload<{
  include: {
    vendor: { select: { vendorName: true; companyName: true } };
    breakdowns: true;
  };
}>;

function vendorCommissionWhere(month: string, status?: string): Prisma.CommissionCalculationWhereInput {
  return { month, ...(status ? { status: status as never } : {}) };
}

function toVendorCommissionRow(c: CalcWithRelations): VendorCommissionRow {
  const gross = toNum(c.grossCommission);
  const fixedPay = toNum(c.fixedPayAmount);
  const gst = toNum(c.gstAmount);
  const tds = toNum(c.tdsAmount);
  const final = toNum(c.finalPayable);
  return {
    calculationId: c.id,
    vendorName: c.vendor.vendorName,
    companyName: c.vendor.companyName,
    status: c.status,
    totalSales: toNum(c.totalSales),
    agrAmount: toNum(c.agrAmount),
    zones: c.breakdowns.map((b) => ({
      zoneName: b.zoneName,
      zoneType: b.zoneType,
      commissionPercentage: toNum(b.commissionPercentage),
      baseAmount: toNum(b.baseAmount),
      commissionAmount: toNum(b.commissionAmount),
    })),
    grossCommission: gross,
    fixedPayAmount: fixedPay,
    gstAmount: gst,
    tdsAmount: tds,
    roundOff: Math.round((final - (gross + fixedPay + gst - tds)) * 100) / 100,
    finalPayable: final,
  };
}

// Month-wide money totals (independent of pagination).
async function vendorCommissionTotals(where: Prisma.CommissionCalculationWhereInput) {
  const agg = await prisma.commissionCalculation.aggregate({
    where,
    _sum: {
      totalSales: true,
      agrAmount: true,
      grossCommission: true,
      fixedPayAmount: true,
      gstAmount: true,
      tdsAmount: true,
      finalPayable: true,
    },
  });
  return {
    totalSales: toNum(agg._sum.totalSales),
    agrAmount: toNum(agg._sum.agrAmount),
    grossCommission: toNum(agg._sum.grossCommission),
    fixedPayAmount: toNum(agg._sum.fixedPayAmount),
    gstAmount: toNum(agg._sum.gstAmount),
    tdsAmount: toNum(agg._sum.tdsAmount),
    finalPayable: toNum(agg._sum.finalPayable),
  };
}

export async function getVendorCommissionReport(
  month: string,
  status?: string,
  page = 1,
  pageSize = 25,
) {
  const where = vendorCommissionWhere(month, status);
  const [total, calcs, totals] = await Promise.all([
    prisma.commissionCalculation.count({ where }),
    prisma.commissionCalculation.findMany({
      where,
      include: {
        vendor: { select: { vendorName: true, companyName: true } },
        breakdowns: true,
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    vendorCommissionTotals(where),
  ]);

  return { month, rows: calcs.map(toVendorCommissionRow), totals, total, page, pageSize };
}

const VC_CURRENCY_FMT = '"₹"#,##0.00';

// Excel export: ALL vendors matching month+status (ignores pagination). One
// sheet row per vendor-zone line; vendor-level amounts only on the first line.
export async function buildVendorCommissionWorkbook(
  month: string,
  status?: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const where = vendorCommissionWhere(month, status);
  const [calcs, totals] = await Promise.all([
    prisma.commissionCalculation.findMany({
      where,
      include: {
        vendor: { select: { vendorName: true, companyName: true } },
        breakdowns: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    vendorCommissionTotals(where),
  ]);
  const rows = calcs.map(toVendorCommissionRow);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'VCMS';
  const ws = wb.addWorksheet('Vendor Commission');
  ws.columns = [
    { header: 'Vendor', key: 'vendor', width: 24 },
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Zone', key: 'zone', width: 26 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Commission %', key: 'pct', width: 14 },
    { header: 'Zone Sales', key: 'zoneSales', width: 16 },
    { header: 'Zone Commission', key: 'zoneCommission', width: 16 },
    { header: 'AGR Amount', key: 'agr', width: 14 },
    { header: 'Fixed Pay', key: 'fixedPay', width: 14 },
    { header: 'Total Commission', key: 'gross', width: 16 },
    { header: 'GST', key: 'gst', width: 14 },
    { header: 'TDS', key: 'tds', width: 14 },
    { header: 'Final Payable', key: 'final', width: 16 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });

  const moneyKeys = ['zoneSales', 'zoneCommission', 'agr', 'fixedPay', 'gross', 'gst', 'tds', 'final'];
  if (rows.length === 0) {
    ws.mergeCells('A2:N2');
    const cell = ws.getCell('A2');
    cell.value = 'No calculations available for the selected filters.';
    cell.alignment = { horizontal: 'center' };
    cell.font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    for (const r of rows) {
      const zones = r.zones.length > 0 ? r.zones : [null];
      zones.forEach((z, i) => {
        const row = ws.addRow({
          vendor: i === 0 ? r.vendorName : '',
          company: i === 0 ? (r.companyName ?? '') : '',
          status: i === 0 ? r.status : '',
          zone: z?.zoneName ?? '-',
          type: z?.zoneType ?? '-',
          pct: z ? z.commissionPercentage / 100 : '',
          zoneSales: z?.baseAmount ?? '',
          zoneCommission: z?.commissionAmount ?? '',
          // Vendor-level amounts on the first line only.
          agr: i === 0 ? r.agrAmount : '',
          fixedPay: i === 0 ? r.fixedPayAmount : '',
          gross: i === 0 ? r.grossCommission : '',
          gst: i === 0 ? r.gstAmount : '',
          tds: i === 0 ? r.tdsAmount : '',
          final: i === 0 ? r.finalPayable : '',
        });
        for (const k of moneyKeys) row.getCell(k).numFmt = VC_CURRENCY_FMT;
        row.getCell('pct').numFmt = '0.00%';
      });
    }
    const totalRow = ws.addRow({
      vendor: 'Total',
      zoneSales: '',
      agr: totals.agrAmount,
      fixedPay: totals.fixedPayAmount,
      gross: totals.grossCommission,
      gst: totals.gstAmount,
      tds: totals.tdsAmount,
      final: totals.finalPayable,
    });
    totalRow.font = { bold: true };
    for (const k of moneyKeys) totalRow.getCell(k).numFmt = VC_CURRENCY_FMT;
  }

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, fileName: `Vendor_Commission_${month}.xlsx` };
}

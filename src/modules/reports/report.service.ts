import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { deriveRoundOff } from '../calculations/commission.engine.js';

const toNum = (d: unknown) => Number(d ?? 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ZoneCommissionRow {
  zone: string;
  newSales: number;
  renewalSales: number;
  totalSales: number;
  newCommission: number;
  renewalCommission: number;
  commissionAmount: number; // total commission (both types)
  netSales: number; // totalSales - commissionAmount
}

export interface ZoneCommissionReport {
  month: string;
  rows: ZoneCommissionRow[];
  summary: {
    totalZones: number;
    newSales: number;
    renewalSales: number;
    totalSales: number;
    newCommission: number;
    renewalCommission: number;
    totalCommission: number;
    netSales: number;
    averageCommissionPercentage: number;
  };
}

const SORT_KEYS = new Set([
  'zone',
  'newSales',
  'renewalSales',
  'totalSales',
  'newCommission',
  'renewalCommission',
  'commissionAmount',
  'netSales',
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

// Zone-wise commission for a month, split by NEW/RENEWAL. Sales come from the
// uploaded sheet (SalesRow, grouped per zone+type); commission comes from
// approved calculation zone-breakdowns (same source as the dashboard's Zone
// Performance), also per zone+type. Merged per zone (case-insensitive name).
// Net sales = total sales - total commission.
export async function getZoneCommissionReport(
  month: string,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
): Promise<ZoneCommissionReport> {
  const [salesGroups, commGroups] = await Promise.all([
    prisma.salesRow.groupBy({
      by: ['zoneName', 'salesType'],
      where: { upload: { month } },
      _sum: { planAmount: true },
    }),
    prisma.commissionZoneBreakdown.groupBy({
      by: ['zoneName', 'zoneType'],
      where: { calculation: { status: 'APPROVED', month } },
      _sum: { commissionAmount: true },
    }),
  ]);

  // Merge both sources by lower-cased zone name, splitting per type.
  interface Acc {
    display: string;
    newSales: number;
    renewalSales: number;
    newCommission: number;
    renewalCommission: number;
    otherCommission: number; // legacy breakdowns without a zoneType snapshot
  }
  const merged = new Map<string, Acc>();
  const acc = (zoneName: string): Acc => {
    const key = zoneName.toLowerCase();
    let cur = merged.get(key);
    if (!cur) {
      cur = { display: zoneName, newSales: 0, renewalSales: 0, newCommission: 0, renewalCommission: 0, otherCommission: 0 };
      merged.set(key, cur);
    }
    return cur;
  };
  for (const s of salesGroups) {
    const cur = acc(s.zoneName);
    if (s.salesType === 'RENEWAL') cur.renewalSales += toNum(s._sum.planAmount);
    else cur.newSales += toNum(s._sum.planAmount);
  }
  for (const c of commGroups) {
    const cur = acc(c.zoneName);
    const amount = toNum(c._sum.commissionAmount);
    if (c.zoneType === 'NEW') cur.newCommission += amount;
    else if (c.zoneType === 'RENEWAL') cur.renewalCommission += amount;
    else cur.otherCommission += amount;
  }

  const rows: ZoneCommissionRow[] = [...merged.values()].map((v) => {
    const totalSales = round2(v.newSales + v.renewalSales);
    const commissionAmount = round2(v.newCommission + v.renewalCommission + v.otherCommission);
    return {
      zone: v.display,
      newSales: round2(v.newSales),
      renewalSales: round2(v.renewalSales),
      totalSales,
      newCommission: round2(v.newCommission),
      renewalCommission: round2(v.renewalCommission),
      commissionAmount,
      netSales: round2(totalSales - commissionAmount),
    };
  });

  const sorted = sortRows(rows, sortBy, sortOrder);
  const sum = (f: (r: ZoneCommissionRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  const totalSales = sum((r) => r.totalSales);
  const totalCommission = sum((r) => r.commissionAmount);

  return {
    month,
    rows: sorted,
    summary: {
      totalZones: rows.length,
      newSales: sum((r) => r.newSales),
      renewalSales: sum((r) => r.renewalSales),
      totalSales,
      newCommission: sum((r) => r.newCommission),
      renewalCommission: sum((r) => r.renewalCommission),
      totalCommission,
      netSales: round2(totalSales - totalCommission),
      averageCommissionPercentage: totalSales > 0 ? (totalCommission / totalSales) * 100 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Excel export — single sheet "Zone Commission Summary"
// ---------------------------------------------------------------------------

const CURRENCY_FMT = '"₹"#,##0.00';

export async function buildZoneCommissionWorkbook(
  month: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const report = await getZoneCommissionReport(month);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VCMS';
  const ws = wb.addWorksheet('Zone Commission Summary');
  ws.columns = [
    { header: 'Zone', key: 'zone', width: 26 },
    { header: 'New Sales', key: 'newSales', width: 16 },
    { header: 'Renewal Sales', key: 'renewalSales', width: 16 },
    { header: 'Total Sales', key: 'totalSales', width: 16 },
    { header: 'New Commission', key: 'newCommission', width: 16 },
    { header: 'Renewal Commission', key: 'renewalCommission', width: 18 },
    { header: 'Total Commission', key: 'commission', width: 16 },
    { header: 'Net Sales', key: 'netSales', width: 16 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });

  const moneyKeys = [
    'newSales',
    'renewalSales',
    'totalSales',
    'newCommission',
    'renewalCommission',
    'commission',
    'netSales',
  ];
  if (report.rows.length === 0) {
    ws.mergeCells('A2:H2');
    const cell = ws.getCell('A2');
    cell.value = 'No commission data available for the selected month.';
    cell.alignment = { horizontal: 'center' };
    cell.font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    for (const r of report.rows) {
      const row = ws.addRow({
        zone: r.zone,
        newSales: r.newSales,
        renewalSales: r.renewalSales,
        totalSales: r.totalSales,
        newCommission: r.newCommission,
        renewalCommission: r.renewalCommission,
        commission: r.commissionAmount,
        netSales: r.netSales,
      });
      for (const k of moneyKeys) row.getCell(k).numFmt = CURRENCY_FMT;
    }
    // Totals row: new / renewal / overall totals for sales + commission.
    const totalRow = ws.addRow({
      zone: 'Total',
      newSales: report.summary.newSales,
      renewalSales: report.summary.renewalSales,
      totalSales: report.summary.totalSales,
      newCommission: report.summary.newCommission,
      renewalCommission: report.summary.renewalCommission,
      commission: report.summary.totalCommission,
      netSales: report.summary.netSales,
    });
    totalRow.font = { bold: true };
    for (const k of moneyKeys) totalRow.getCell(k).numFmt = CURRENCY_FMT;
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
    roundOff: deriveRoundOff({
      grossCommission: gross,
      fixedPayAmount: fixedPay,
      gstAmount: gst,
      tdsAmount: tds,
      finalPayable: final,
    }),
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

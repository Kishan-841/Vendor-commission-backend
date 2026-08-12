import ExcelJS from 'exceljs';
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

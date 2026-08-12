import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit } from '../../lib/audit.js';

const CURRENCY_FMT = '"₹"#,##0.00';
const DATE_FMT = 'dd-mmm-yyyy';

const n = (d: unknown) => Number(d ?? 0);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-06" -> "Jun 2026"
function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return month;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Build the vendor + month Excel workbook (two sheets: Sales Summary + Sales
// Zone Data). A vendor "owns" a sales row when the row's (zoneName, salesType)
// matches one of the vendor's zone assignments — the same linkage the
// commission engine uses (sales sheets carry no vendor column).
export async function buildVendorMonthWorkbook(
  month: string,
  vendorId: string,
  actorId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { zoneAssignments: { include: { zone: true } } },
  });
  if (!vendor) throw ApiError.notFound('Vendor not found');

  // Assignment set keyed by "zonename|TYPE" (case-insensitive zone name).
  const assignmentKeys = new Set(
    vendor.zoneAssignments.map((a) => `${a.zone.name.toLowerCase()}|${a.zoneType}`),
  );

  let rows: Awaited<ReturnType<typeof prisma.salesRow.findMany>> = [];
  if (assignmentKeys.size > 0) {
    // All rows for the month across its New + Renewal uploads.
    const all = await prisma.salesRow.findMany({ where: { upload: { month } } });
    rows = all.filter((r) => assignmentKeys.has(`${r.zoneName.toLowerCase()}|${r.salesType}`));
  }
  // Sort by Zone, then Date (spec).
  rows.sort((a, b) => {
    const z = a.zoneName.localeCompare(b.zoneName);
    if (z !== 0) return z;
    const da = a.billDate ? a.billDate.getTime() : 0;
    const db = b.billDate ? b.billDate.getTime() : 0;
    return da - db;
  });

  const monthLabel = formatMonthLabel(month);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VCMS';

  buildSummarySheet(wb, vendor.vendorName, monthLabel, rows);
  buildZoneDataSheet(wb, vendor.vendorName, rows);

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

  await writeAudit({
    userId: actorId,
    action: 'SALES_EXPORTED',
    entityType: 'Vendor',
    entityId: vendorId,
    metadata: { month, vendorName: vendor.vendorName, rows: rows.length },
  });

  const safeVendor = vendor.vendorName.replace(/[^\w]+/g, '_');
  return { buffer, fileName: `Sales_${safeVendor}_${month}.xlsx` };
}

type SalesRowRecord = Awaited<ReturnType<typeof prisma.salesRow.findMany>>[number];

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
}

// Sheet 1 — one aggregate row for the vendor + month.
function buildSummarySheet(
  wb: ExcelJS.Workbook,
  vendorName: string,
  monthLabel: string,
  rows: SalesRowRecord[],
) {
  const ws = wb.addWorksheet('Sales Summary');
  ws.columns = [
    { header: 'Vendor Name', key: 'vendor', width: 24 },
    { header: 'Month', key: 'month', width: 16 },
    { header: 'Total Orders', key: 'orders', width: 14 },
    { header: 'Total Quantity', key: 'qty', width: 15 },
    { header: 'Gross Sales', key: 'gross', width: 16 },
    { header: 'Discounts', key: 'discount', width: 14 },
    { header: 'Net Sales', key: 'net', width: 16 },
    { header: 'Taxes', key: 'taxes', width: 14 },
    { header: 'Grand Total', key: 'grand', width: 16 },
  ];
  styleHeader(ws.getRow(1));

  if (rows.length === 0) {
    ws.mergeCells('A2:I2');
    const cell = ws.getCell('A2');
    cell.value = 'No data available for the selected filters.';
    cell.alignment = { horizontal: 'center' };
    cell.font = { italic: true, color: { argb: 'FF888888' } };
    return;
  }

  const gross = rows.reduce((s, r) => s + n(r.billAmount), 0);
  const discounts = rows.reduce((s, r) => s + n(r.discountAmount), 0);
  const net = rows.reduce((s, r) => s + n(r.actualBillAmount), 0);
  const taxes = rows.reduce((s, r) => s + n(r.sgst) + n(r.cgst), 0);
  const grand = rows.reduce((s, r) => s + n(r.planAmount), 0);

  const row = ws.addRow({
    vendor: vendorName,
    month: monthLabel,
    orders: rows.length,
    qty: rows.length, // each subscriber row = 1 subscription (sheet has no quantity column)
    gross,
    discount: discounts,
    net,
    taxes,
    grand,
  });
  // Currency formatting on money columns (E–I).
  ['gross', 'discount', 'net', 'taxes', 'grand'].forEach((k) => {
    row.getCell(k).numFmt = CURRENCY_FMT;
  });
}

// Sheet 2 — detailed records, sorted by zone then date.
function buildZoneDataSheet(wb: ExcelJS.Workbook, vendorName: string, rows: SalesRowRecord[]) {
  const ws = wb.addWorksheet('Sales Zone Data');
  ws.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Invoice Number', key: 'invoice', width: 18 },
    { header: 'Vendor Name', key: 'vendor', width: 22 },
    { header: 'Customer Name', key: 'customer', width: 26 },
    { header: 'Zone', key: 'zone', width: 22 },
    { header: 'Product', key: 'product', width: 26 },
    { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Unit Price', key: 'unit', width: 14 },
    { header: 'Discount', key: 'discount', width: 13 },
    { header: 'Tax', key: 'tax', width: 13 },
    { header: 'Net Amount', key: 'net', width: 15 },
  ];
  styleHeader(ws.getRow(1));

  if (rows.length === 0) {
    ws.mergeCells('A2:K2');
    const cell = ws.getCell('A2');
    cell.value = 'No data available for the selected filters.';
    cell.alignment = { horizontal: 'center' };
    cell.font = { italic: true, color: { argb: 'FF888888' } };
    return;
  }

  for (const r of rows) {
    const row = ws.addRow({
      date: r.billDate ?? null,
      invoice: r.billNo ?? '',
      vendor: vendorName,
      customer: r.customerName ?? '',
      zone: r.zoneName,
      product: r.planName ?? '',
      qty: 1,
      unit: n(r.planAmount),
      discount: n(r.discountAmount),
      tax: n(r.sgst) + n(r.cgst),
      net: n(r.actualBillAmount),
    });
    if (r.billDate) row.getCell('date').numFmt = DATE_FMT;
    (['unit', 'discount', 'tax', 'net'] as const).forEach((k) => {
      row.getCell(k).numFmt = CURRENCY_FMT;
    });
  }
}

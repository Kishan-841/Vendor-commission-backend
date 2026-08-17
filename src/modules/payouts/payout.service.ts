import type { PayoutStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit, diffChanges } from '../../lib/audit.js';
import { pageMeta } from '../../utils/apiResponse.js';
import { storage } from '../../lib/storage.js';
import { generateReceiptPdf, generateLedgerPdf } from '../../lib/pdf.js';
import type { RecordPaymentInput } from './payout.schema.js';

// Payouts operate on APPROVED calculations only — a payout IS an approved
// commission. Draft/submitted/rejected calcs never appear here.
const APPROVED = { status: 'APPROVED' as const };

const toNum = (d: unknown) => Number(d ?? 0);

function statusFor(total: number, paid: number): PayoutStatus {
  if (total > 0 && paid >= total) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Vendor-wise summary list
// ---------------------------------------------------------------------------

export interface VendorPayoutSummary {
  vendorId: string;
  vendorName: string;
  companyName: string | null;
  vendorStatus: string;
  calculationCount: number;
  totalCommission: number;
  totalPaid: number;
  totalPending: number;
  paymentStatus: PayoutStatus;
  lastPaymentDate: string | null;
}

// Distinct months that have approved calculations — drives the list's month filter.
export async function listPayoutMonths(): Promise<string[]> {
  const groups = await prisma.commissionCalculation.groupBy({
    by: ['month'],
    where: APPROVED,
    orderBy: { month: 'desc' },
  });
  return groups.map((g) => g.month);
}

export async function listVendorPayouts(query: {
  search?: string;
  status?: PayoutStatus;
  month?: string;
  page: number;
  pageSize: number;
}) {
  // Optional month scope — aggregates then reflect only that month's approved calcs.
  const calcWhere = { ...APPROVED, ...(query.month ? { month: query.month } : {}) };

  // Aggregate approved calcs per vendor. Vendor counts are small (tens–hundreds),
  // so aggregate fully then filter/paginate in memory.
  const groups = await prisma.commissionCalculation.groupBy({
    by: ['vendorId'],
    where: calcWhere,
    _sum: { finalPayable: true, paidAmount: true },
    _count: { _all: true },
  });
  if (groups.length === 0) {
    return {
      items: [] as VendorPayoutSummary[],
      meta: pageMeta(1, query.pageSize, 0),
      totals: { totalCommission: 0, totalPaid: 0, totalPending: 0 },
    };
  }

  const vendorIds = groups.map((g) => g.vendorId);
  const [vendors, lastPayments] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, vendorName: true, companyName: true, status: true },
    }),
    prisma.payoutPayment.findMany({
      where: { calculation: { vendorId: { in: vendorIds }, ...calcWhere } },
      select: { paymentDate: true, calculation: { select: { vendorId: true } } },
      orderBy: { paymentDate: 'desc' },
    }),
  ]);
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const lastPaymentByVendor = new Map<string, Date>();
  for (const p of lastPayments) {
    const vid = p.calculation.vendorId;
    if (!lastPaymentByVendor.has(vid)) lastPaymentByVendor.set(vid, p.paymentDate);
  }

  let items: VendorPayoutSummary[] = groups
    .map((g) => {
      const vendor = vendorById.get(g.vendorId);
      const total = toNum(g._sum.finalPayable);
      const paid = toNum(g._sum.paidAmount);
      return {
        vendorId: g.vendorId,
        vendorName: vendor?.vendorName ?? 'Unknown vendor',
        companyName: vendor?.companyName ?? null,
        vendorStatus: vendor?.status ?? 'ACTIVE',
        calculationCount: g._count._all,
        totalCommission: total,
        totalPaid: paid,
        totalPending: Math.max(0, total - paid),
        paymentStatus: statusFor(total, paid),
        lastPaymentDate: lastPaymentByVendor.get(g.vendorId)?.toISOString() ?? null,
      };
    })
    .sort((a, b) => b.totalPending - a.totalPending || b.totalCommission - a.totalCommission);

  if (query.search) {
    const s = query.search.toLowerCase();
    items = items.filter(
      (i) => i.vendorName.toLowerCase().includes(s) || (i.companyName ?? '').toLowerCase().includes(s),
    );
  }
  if (query.status) items = items.filter((i) => i.paymentStatus === query.status);

  const total = items.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    items: items.slice(start, start + query.pageSize),
    meta: pageMeta(query.page, query.pageSize, total),
    // Grand totals across ALL matching vendors (not just this page).
    totals: {
      totalCommission: items.reduce((s, i) => s + i.totalCommission, 0),
      totalPaid: items.reduce((s, i) => s + i.totalPaid, 0),
      totalPending: items.reduce((s, i) => s + i.totalPending, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Vendor detail: month-wise approved calcs with their payments
// ---------------------------------------------------------------------------

export async function getVendorPayoutDetail(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true,
      vendorName: true,
      companyName: true,
      status: true,
      email: true,
      mobileNumber: true,
    },
  });
  if (!vendor) throw ApiError.notFound('Vendor not found');

  const calculations = await prisma.commissionCalculation.findMany({
    where: { vendorId, ...APPROVED },
    orderBy: { month: 'desc' },
    include: {
      bill: { select: { id: true, billNumber: true } },
      payments: {
        orderBy: { paymentDate: 'desc' },
        include: { paidBy: { select: { name: true } } },
      },
    },
  });

  const totalCommission = calculations.reduce((s, c) => s + toNum(c.finalPayable), 0);
  const totalPaid = calculations.reduce((s, c) => s + toNum(c.paidAmount), 0);
  const allPayments = calculations.flatMap((c) => c.payments);
  const lastPayment = allPayments.reduce<Date | null>(
    (latest, p) => (!latest || p.paymentDate > latest ? p.paymentDate : latest),
    null,
  );

  return {
    vendor,
    summary: {
      totalCommission,
      totalPaid,
      totalPending: Math.max(0, totalCommission - totalPaid),
      paymentStatus: statusFor(totalCommission, totalPaid),
      calculationCount: calculations.length,
      paymentCount: allPayments.length,
      lastPaymentDate: lastPayment?.toISOString() ?? null,
    },
    calculations,
  };
}

// ---------------------------------------------------------------------------
// Record / delete a payment (calc totals cached in the same transaction)
// ---------------------------------------------------------------------------

// Generate the next unique receipt number for a payment date's month:
// RCPT-YYYYMM-NNNN (sequential within the month).
async function nextReceiptNumber(paymentDate: Date): Promise<string> {
  const ym = `${paymentDate.getUTCFullYear()}${String(paymentDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const prefix = `RCPT-${ym}-`;
  const count = await prisma.payoutPayment.count({ where: { receiptNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

export async function recordPayment(
  calculationId: string,
  input: RecordPaymentInput,
  actorId: string,
  attachmentPath?: string | null,
) {
  const calc = await prisma.commissionCalculation.findUnique({
    where: { id: calculationId },
    select: { id: true, status: true, finalPayable: true, paidAmount: true, vendorId: true, month: true },
  });
  if (!calc) throw ApiError.notFound('Calculation not found');
  if (calc.status !== 'APPROVED') {
    throw ApiError.badRequest('Only APPROVED calculations can be paid');
  }

  const outstanding = toNum(calc.finalPayable) - toNum(calc.paidAmount);
  // Tiny epsilon so "pay exactly the outstanding" never trips on decimal noise.
  if (input.paidAmount > outstanding + 0.005) {
    throw ApiError.badRequest(
      `Paid amount exceeds the outstanding balance (₹${outstanding.toFixed(2)})`,
    );
  }

  const paymentDate = new Date(`${input.paymentDate}T00:00:00Z`);
  const receiptNumber = await nextReceiptNumber(paymentDate);
  const newPaid = toNum(calc.paidAmount) + input.paidAmount;
  const [payment, updated] = await prisma.$transaction([
    prisma.payoutPayment.create({
      data: {
        calculationId,
        receiptNumber,
        paidAmount: input.paidAmount,
        paymentDate,
        paymentMode: input.paymentMode,
        paymentReference: input.paymentReference || null,
        notes: input.notes || null,
        attachmentPath: attachmentPath || null,
        paidById: actorId,
      },
      include: { paidBy: { select: { name: true } } },
    }),
    prisma.commissionCalculation.update({
      where: { id: calculationId },
      data: {
        paidAmount: newPaid,
        paymentStatus: statusFor(toNum(calc.finalPayable), newPaid),
      },
    }),
  ]);

  await writeAudit({
    userId: actorId,
    action: 'PAYMENT_RECORDED',
    entityType: 'PayoutPayment',
    entityId: payment.id,
    metadata: {
      calculationId,
      vendorId: calc.vendorId,
      month: calc.month,
      paidAmount: input.paidAmount,
      paymentMode: input.paymentMode,
    },
  });

  return { payment, calculation: updated };
}

// Update a receipt. Amount changes recompute the calc's cached paid total and
// status; passing `attachmentPath` replaces the file (undefined keeps it).
export async function updatePayment(
  paymentId: string,
  input: RecordPaymentInput,
  actorId: string,
  attachmentPath?: string | null,
) {
  const payment = await prisma.payoutPayment.findUnique({
    where: { id: paymentId },
    include: { calculation: { select: { id: true, finalPayable: true, paidAmount: true } } },
  });
  if (!payment) throw ApiError.notFound('Receipt not found');

  // Outstanding excluding this receipt's current amount.
  const otherPaid = toNum(payment.calculation.paidAmount) - toNum(payment.paidAmount);
  const outstanding = toNum(payment.calculation.finalPayable) - otherPaid;
  if (input.paidAmount > outstanding + 0.005) {
    throw ApiError.badRequest(`Amount exceeds the outstanding balance (₹${outstanding.toFixed(2)})`);
  }

  // Remove the old attachment if a new one replaces it.
  if (attachmentPath !== undefined && payment.attachmentPath) {
    await storage.delete(payment.attachmentPath);
  }

  const newPaid = otherPaid + input.paidAmount;
  const [updatedPayment, updatedCalc] = await prisma.$transaction([
    prisma.payoutPayment.update({
      where: { id: paymentId },
      data: {
        paidAmount: input.paidAmount,
        paymentDate: new Date(`${input.paymentDate}T00:00:00Z`),
        paymentMode: input.paymentMode,
        paymentReference: input.paymentReference || null,
        notes: input.notes || null,
        ...(attachmentPath !== undefined ? { attachmentPath: attachmentPath || null } : {}),
      },
      include: { paidBy: { select: { name: true } } },
    }),
    prisma.commissionCalculation.update({
      where: { id: payment.calculation.id },
      data: {
        paidAmount: newPaid,
        paymentStatus: statusFor(toNum(payment.calculation.finalPayable), newPaid),
      },
    }),
  ]);

  await writeAudit({
    userId: actorId,
    action: 'PAYMENT_UPDATED',
    entityType: 'PayoutPayment',
    entityId: paymentId,
    metadata: {
      calculationId: payment.calculation.id,
      paidAmount: input.paidAmount,
      changes: diffChanges(payment as unknown as Record<string, unknown>, {
        paidAmount: input.paidAmount,
        paymentDate: new Date(`${input.paymentDate}T00:00:00Z`),
        paymentMode: input.paymentMode,
        paymentReference: input.paymentReference || null,
        notes: input.notes || null,
      }),
    },
  });

  return { payment: updatedPayment, calculation: updatedCalc };
}

export async function deletePayment(paymentId: string, actorId: string) {
  const payment = await prisma.payoutPayment.findUnique({
    where: { id: paymentId },
    include: { calculation: { select: { id: true, finalPayable: true, paidAmount: true } } },
  });
  if (!payment) throw ApiError.notFound('Payment not found');

  if (payment.attachmentPath) await storage.delete(payment.attachmentPath);

  const newPaid = Math.max(0, toNum(payment.calculation.paidAmount) - toNum(payment.paidAmount));
  await prisma.$transaction([
    prisma.payoutPayment.delete({ where: { id: paymentId } }),
    prisma.commissionCalculation.update({
      where: { id: payment.calculation.id },
      data: {
        paidAmount: newPaid,
        paymentStatus: statusFor(toNum(payment.calculation.finalPayable), newPaid),
      },
    }),
  ]);

  await writeAudit({
    userId: actorId,
    action: 'PAYMENT_DELETED',
    entityType: 'PayoutPayment',
    entityId: paymentId,
    metadata: { calculationId: payment.calculation.id, paidAmount: toNum(payment.paidAmount) },
  });
}

export async function getPaymentAttachment(paymentId: string) {
  const payment = await prisma.payoutPayment.findUnique({ where: { id: paymentId } });
  if (!payment || !payment.attachmentPath) throw ApiError.notFound('Attachment not available');
  const { stream, contentLength } = await storage.getStream(payment.attachmentPath);
  // The key ends in "…__<originalName>"; recover a friendly filename.
  const fileName = payment.attachmentPath.split('__').slice(1).join('__') || 'attachment';
  return { stream, contentLength, fileName };
}

// ---------------------------------------------------------------------------
// Vendor ledger: payout-generated debits + receipt credits, running balance
// ---------------------------------------------------------------------------

// Commission math behind a Payout Generated line, from the calc snapshot.
export interface LedgerBreakdown {
  grossCommission: number;
  fixedPayAmount: number;
  gstAmount: number;
  tdsAmount: number;
  roundOff: number;
  finalPayable: number;
}

export interface LedgerEntry {
  date: string;
  transactionType: 'Payout Generated' | 'Receipt';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  breakdown?: LedgerBreakdown; // present on Payout Generated entries
}

export async function getVendorLedger(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, vendorName: true, companyName: true, status: true, email: true, mobileNumber: true },
  });
  if (!vendor) throw ApiError.notFound('Vendor not found');

  const calculations = await prisma.commissionCalculation.findMany({
    where: { vendorId, ...APPROVED },
    orderBy: { month: 'asc' },
    include: {
      bill: { select: { billNumber: true } },
      breakdowns: { select: { zoneName: true } },
      approvals: {
        where: { action: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
      payments: {
        orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
        include: { paidBy: { select: { name: true } } },
      },
    },
  });

  // Payouts (for the receipt form's month dropdown) — each with outstanding + zones.
  const payouts = calculations.map((c) => ({
    calculationId: c.id,
    month: c.month,
    billNumber: c.bill?.billNumber ?? null,
    finalPayable: toNum(c.finalPayable),
    paidAmount: toNum(c.paidAmount),
    outstanding: Math.max(0, toNum(c.finalPayable) - toNum(c.paidAmount)),
    zones: [...new Set(c.breakdowns.map((b) => b.zoneName))],
  }));

  // Flat receipts list across all the vendor's payouts.
  const receipts = calculations
    .flatMap((c) =>
      c.payments.map((p) => ({
        id: p.id,
        calculationId: c.id,
        month: c.month,
        receiptNumber: p.receiptNumber,
        paymentDate: p.paymentDate.toISOString(),
        paymentMode: p.paymentMode,
        paymentReference: p.paymentReference,
        amount: toNum(p.paidAmount),
        notes: p.notes,
        createdBy: p.paidBy?.name ?? null,
        hasAttachment: !!p.attachmentPath,
        zones: [...new Set(c.breakdowns.map((b) => b.zoneName))],
      })),
    )
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

  // Ledger: payout-generated debits (dated at approval) + receipt credits, chronological.
  type Raw = Omit<LedgerEntry, 'balance'> & { sortKey: number };
  const raw: Raw[] = [];
  for (const c of calculations) {
    const genDate = c.approvals[0]?.createdAt ?? c.updatedAt;
    const gross = toNum(c.grossCommission);
    const fixedPay = toNum(c.fixedPayAmount);
    const gst = toNum(c.gstAmount);
    const tds = toNum(c.tdsAmount);
    const final = toNum(c.finalPayable);
    raw.push({
      date: genDate.toISOString(),
      transactionType: 'Payout Generated',
      reference: c.bill?.billNumber ?? c.month,
      description: `${monthLabel(c.month)} commission`,
      debit: final,
      credit: 0,
      breakdown: {
        grossCommission: gross,
        fixedPayAmount: fixedPay,
        gstAmount: gst,
        tdsAmount: tds,
        roundOff: Math.round((final - (gross + fixedPay + gst - tds)) * 100) / 100,
        finalPayable: final,
      },
      sortKey: genDate.getTime(),
    });
    for (const p of c.payments) {
      raw.push({
        date: p.paymentDate.toISOString(),
        transactionType: 'Receipt',
        reference: p.receiptNumber ?? '—',
        description: p.paymentMode.replace(/_/g, ' ') + (p.notes ? ` · ${p.notes}` : ''),
        debit: 0,
        credit: toNum(p.paidAmount),
        sortKey: p.paymentDate.getTime(),
      });
    }
  }
  raw.sort((a, b) => a.sortKey - b.sortKey);
  let balance = 0;
  const ledger: LedgerEntry[] = raw.map(({ sortKey: _sortKey, ...e }) => {
    balance += e.debit - e.credit;
    return { ...e, balance };
  });

  const totalPayout = calculations.reduce((s, c) => s + toNum(c.finalPayable), 0);
  const totalReceived = calculations.reduce((s, c) => s + toNum(c.paidAmount), 0);

  return {
    vendor,
    summary: {
      totalPayout,
      totalReceived,
      outstanding: Math.max(0, totalPayout - totalReceived),
      receiptCount: receipts.length,
    },
    payouts,
    receipts,
    ledger,
  };
}

function monthLabel(month: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = month.split('-').map(Number);
  return y && m ? `${names[m - 1]} ${y}` : month;
}

// ---------------------------------------------------------------------------
// Receipt PDF (generated on demand)
// ---------------------------------------------------------------------------

export async function generatePaymentReceipt(paymentId: string) {
  const payment = await prisma.payoutPayment.findUnique({
    where: { id: paymentId },
    include: {
      paidBy: { select: { name: true } },
      calculation: {
        include: {
          vendor: { select: { vendorName: true, companyName: true, address: true, panNumber: true } },
          bill: { select: { billNumber: true } },
        },
      },
    },
  });
  if (!payment) throw ApiError.notFound('Payment not found');

  // Prefer the stored receipt number; fall back to a derived one for any legacy row.
  const receiptNumber =
    payment.receiptNumber ??
    `RCPT-${payment.createdAt.toISOString().slice(0, 7).replace('-', '')}-${payment.id.slice(-6).toUpperCase()}`;

  const buffer = await generateReceiptPdf({
    receiptNumber,
    paymentDate: payment.paymentDate,
    paymentMode: payment.paymentMode,
    paymentReference: payment.paymentReference,
    notes: payment.notes,
    paidAmount: toNum(payment.paidAmount),
    paidByName: payment.paidBy?.name ?? null,
    vendor: {
      name: payment.calculation.vendor.vendorName,
      companyName: payment.calculation.vendor.companyName,
      address: payment.calculation.vendor.address,
      panNumber: payment.calculation.vendor.panNumber,
    },
    calculation: {
      month: payment.calculation.month,
      finalPayable: toNum(payment.calculation.finalPayable),
      totalPaid: toNum(payment.calculation.paidAmount),
      billNumber: payment.calculation.bill?.billNumber ?? null,
    },
  });

  return { buffer, receiptNumber };
}

// Full vendor ledger PDF: payout info, receipt summary, ledger transactions, totals.
export async function generateVendorLedgerPdf(vendorId: string) {
  const data = await getVendorLedger(vendorId);
  const buffer = await generateLedgerPdf({
    vendor: {
      name: data.vendor.vendorName,
      companyName: data.vendor.companyName,
      email: data.vendor.email,
      mobileNumber: data.vendor.mobileNumber,
    },
    summary: data.summary,
    receipts: data.receipts.map((r) => ({
      receiptNumber: r.receiptNumber ?? '—',
      paymentDate: new Date(r.paymentDate),
      paymentMode: r.paymentMode,
      paymentReference: r.paymentReference,
      amount: r.amount,
    })),
    ledger: data.ledger.map((e) => ({
      date: new Date(e.date),
      transactionType: e.transactionType,
      reference: e.reference,
      description: e.description,
      debit: e.debit,
      credit: e.credit,
      balance: e.balance,
      breakdown: e.breakdown,
    })),
  });
  const safe = data.vendor.vendorName.replace(/[^\w]+/g, '_');
  return { buffer, fileName: `Ledger_${safe}.pdf` };
}

// ---------------------------------------------------------------------------
// CSV export — one row per approved calculation
// ---------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportPayoutsCsv() {
  const calcs = await prisma.commissionCalculation.findMany({
    where: APPROVED,
    orderBy: [{ month: 'desc' }],
    include: {
      vendor: { select: { vendorName: true, companyName: true } },
      bill: { select: { billNumber: true } },
      payments: { orderBy: { paymentDate: 'desc' }, select: { paymentDate: true } },
    },
  });

  const header = [
    'Vendor',
    'Company',
    'Month',
    'Total Sales',
    'Gross Commission',
    'GST',
    'TDS',
    'Fixed Pay',
    'Final Payable',
    'Paid',
    'Outstanding',
    'Payment Status',
    'Last Payment Date',
    'Bill No',
  ];
  const rows = calcs.map((c) => {
    const total = toNum(c.finalPayable);
    const paid = toNum(c.paidAmount);
    return [
      c.vendor.vendorName,
      c.vendor.companyName ?? '',
      c.month,
      toNum(c.totalSales).toFixed(2),
      toNum(c.grossCommission).toFixed(2),
      toNum(c.gstAmount).toFixed(2),
      toNum(c.tdsAmount).toFixed(2),
      toNum(c.fixedPayAmount).toFixed(2),
      total.toFixed(2),
      paid.toFixed(2),
      Math.max(0, total - paid).toFixed(2),
      c.paymentStatus,
      c.payments[0]?.paymentDate.toISOString().slice(0, 10) ?? '',
      c.bill?.billNumber ?? '',
    ];
  });

  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

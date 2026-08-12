import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit } from '../../lib/audit.js';
import { pageMeta } from '../../utils/apiResponse.js';
import { generateBillPdf } from '../../lib/pdf.js';

const billInclude = {
  vendor: { select: { id: true, vendorName: true, companyName: true } },
  items: true,
} satisfies Prisma.BillInclude;

// Bill number format: GZN/YYYYMM/0001 — sequential within the billing month.
async function nextBillNumber(tx: Prisma.TransactionClient, billingMonth: string) {
  const monthKey = billingMonth.replace('-', ''); // 2026-07 -> 202607
  const count = await tx.bill.count({ where: { billingMonth } });
  const seq = String(count + 1).padStart(4, '0');
  return `GZN/${monthKey}/${seq}`;
}

export async function generateBill(calculationId: string, actorId: string) {
  const calc = await prisma.commissionCalculation.findUnique({
    where: { id: calculationId },
    include: { vendor: true, breakdowns: true, bill: true },
  });
  if (!calc) throw ApiError.notFound('Calculation not found');

  // Bills are generated ONLY after approval, and only once per calculation.
  if (calc.status !== 'APPROVED') {
    throw ApiError.conflict('A bill can only be generated for an APPROVED calculation');
  }
  if (calc.bill) {
    throw ApiError.conflict('A bill has already been generated for this calculation');
  }

  // Create bill + line items atomically with a month-sequential bill number.
  const bill = await prisma.$transaction(async (tx) => {
    const billNumber = await nextBillNumber(tx, calc.month);
    return tx.bill.create({
      data: {
        billNumber,
        calculationId: calc.id,
        vendorId: calc.vendorId,
        billingMonth: calc.month,
        grossCommission: calc.grossCommission,
        gstAmount: calc.gstAmount,
        tdsAmount: calc.tdsAmount,
        fixedPayAmount: calc.fixedPayAmount,
        finalPayable: calc.finalPayable,
        generatedById: actorId,
        items: {
          create: calc.breakdowns.map((b) => ({
            description: b.zoneName,
            commissionPercentage: b.commissionPercentage,
            baseAmount: b.baseAmount,
            amount: b.commissionAmount,
          })),
        },
      },
      include: billInclude,
    });
  });

  // Render the PDF after the DB commit, then attach its path. If rendering ever
  // fails, the bill still exists and the PDF can be regenerated.
  const pdfPath = await generateBillPdf({
    billNumber: bill.billNumber,
    generatedAt: bill.generatedAt,
    billingMonth: calc.month,
    billingPeriod: calc.billingPeriod,
    vendor: {
      name: calc.vendor.vendorName,
      companyName: calc.vendor.companyName,
      address: calc.vendor.address,
      email: calc.vendor.email,
      mobileNumber: calc.vendor.mobileNumber,
      panNumber: calc.vendor.panNumber,
      gstNumber: calc.vendor.gstNumber,
    },
    items: bill.items.map((i) => ({
      description: i.description,
      commissionPercentage: i.commissionPercentage != null ? Number(i.commissionPercentage) : null,
      baseAmount: i.baseAmount != null ? Number(i.baseAmount) : null,
      amount: Number(i.amount),
    })),
    grossCommission: Number(bill.grossCommission),
    gstAmount: Number(bill.gstAmount),
    tdsAmount: Number(bill.tdsAmount),
    fixedPayAmount: Number(bill.fixedPayAmount),
    finalPayable: Number(bill.finalPayable),
  });

  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: { pdfPath },
    include: billInclude,
  });

  await writeAudit({
    userId: actorId,
    action: 'BILL_GENERATED',
    entityType: 'Bill',
    entityId: bill.id,
    metadata: { billNumber: bill.billNumber, calculationId, finalPayable: Number(bill.finalPayable) },
  });

  return updated;
}

export async function listBills(query: {
  page: number;
  pageSize: number;
  vendorId?: string;
  month?: string;
}) {
  const { page, pageSize, vendorId, month } = query;
  const where: Prisma.BillWhereInput = {
    ...(vendorId ? { vendorId } : {}),
    ...(month ? { billingMonth: month } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      include: { vendor: { select: { id: true, vendorName: true } } },
      orderBy: { generatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bill.count({ where }),
  ]);
  return { items, meta: pageMeta(page, pageSize, total) };
}

export async function getBill(id: string) {
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: { ...billInclude, calculation: { include: { breakdowns: true } } },
  });
  if (!bill) throw ApiError.notFound('Bill not found');
  return bill;
}

export async function getBillForDownload(id: string) {
  const bill = await prisma.bill.findUnique({ where: { id } });
  if (!bill) throw ApiError.notFound('Bill not found');
  if (!bill.pdfPath) throw ApiError.notFound('Bill PDF is not available');
  return bill;
}

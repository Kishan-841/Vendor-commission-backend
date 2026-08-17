import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit, diffChanges } from '../../lib/audit.js';
import { storage } from '../../lib/storage.js';
import { pageMeta } from '../../utils/apiResponse.js';
import { getNumberSetting, DEFAULT_GST_KEY } from '../../lib/settings.js';
import { computeCommission, type CommissionInput } from './commission.engine.js';
import type {
  CreateCalculationInput,
  ListCalculationsQuery,
  UpdateCalculationInput,
} from './calculation.schema.js';

const calcInclude = {
  vendor: { select: { id: true, vendorName: true, companyName: true, gstNumber: true } },
  breakdowns: true,
  approvals: { orderBy: { createdAt: 'asc' } },
  bill: { select: { id: true, billNumber: true } },
} satisfies Prisma.CommissionCalculationInclude;

// Resolve the rate snapshot + zone names, then run the pure engine. Shared by
// create and update so both paths compute identically.
async function buildComputation(
  input: CreateCalculationInput,
): Promise<{ engineInput: CommissionInput; snapshot: Snapshot }> {
  const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId } });
  if (!vendor) throw ApiError.notFound('Vendor not found');

  // Validate every selected zone is ASSIGNED to this vendor (many-to-many) —
  // prevents picking a (zone, type) pair the vendor doesn't hold — and snapshot
  // the zone name at calc time. A vendor may hold the same zone under both types.
  const assignments = await prisma.vendorZone.findMany({
    where: { vendorId: input.vendorId },
    include: { zone: true },
  });
  const assignmentMap = new Map(assignments.map((a) => [`${a.zoneId}|${a.zoneType}`, a]));
  const missing = input.zones
    .filter((z) => !assignmentMap.has(`${z.zoneId}|${z.zoneType}`))
    .map((z) => `${z.zoneId} (${z.zoneType})`);
  if (missing.length > 0) {
    throw ApiError.badRequest('Some zones are not assigned to this vendor', { zones: missing });
  }

  // GST: explicit override wins; otherwise the vendor's GST number drives it.
  const defaultGst = await getNumberSetting(DEFAULT_GST_KEY, 18);
  const gstPercentage =
    input.gstPercentage ?? (vendor.gstNumber ? defaultGst : 0);

  const agrApplicable = vendor.agrApplicable;
  const agrPercentage = Number(vendor.agrPercentage);
  const tdsPercentage = Number(vendor.tdsPercentage);
  const fixedPayAmount = vendor.fixedPayEnabled ? Number(vendor.fixedPayAmount ?? 0) : 0;

  const engineInput: CommissionInput = {
    totalSales: input.totalSales,
    agrApplicable,
    agrPercentage,
    gstPercentage,
    tdsPercentage,
    fixedPayAmount,
    zones: input.zones.map((z) => ({
      zoneId: z.zoneId,
      zoneName: assignmentMap.get(`${z.zoneId}|${z.zoneType}`)!.zone.name,
      zoneType: z.zoneType,
      commissionPercentage: z.commissionPercentage,
    })),
  };

  return {
    engineInput,
    snapshot: {
      vendorId: input.vendorId,
      month: input.month,
      billingPeriod: input.billingPeriod ?? null,
      agrApplicable,
      agrPercentage,
      gstPercentage,
      tdsPercentage,
    },
  };
}

interface Snapshot {
  vendorId: string;
  month: string;
  billingPeriod: string | null;
  agrApplicable: boolean;
  agrPercentage: number;
  gstPercentage: number;
  tdsPercentage: number;
}

export async function createCalculation(input: CreateCalculationInput, actorId: string) {
  const { engineInput, snapshot } = await buildComputation(input);
  const result = computeCommission(engineInput);

  const calc = await prisma.commissionCalculation.create({
    data: {
      ...snapshot,
      totalSales: input.totalSales,
      agrAmount: result.agrAmount,
      salesAfterAgr: result.salesAfterAgr,
      grossCommission: result.grossCommission,
      gstAmount: result.gstAmount,
      tdsAmount: result.tdsAmount,
      fixedPayAmount: result.fixedPayAmount,
      finalPayable: result.finalPayable,
      status: 'DRAFT',
      createdById: actorId,
      breakdowns: {
        create: result.breakdowns.map((b) => ({
          zoneId: b.zoneId,
          zoneName: b.zoneName,
          zoneType: b.zoneType,
          commissionPercentage: b.commissionPercentage,
          baseAmount: b.baseAmount,
          commissionAmount: b.commissionAmount,
        })),
      },
    },
    include: calcInclude,
  });

  await writeAudit({
    userId: actorId,
    action: 'CALCULATION_CREATED',
    entityType: 'CommissionCalculation',
    entityId: calc.id,
    metadata: { vendorId: input.vendorId, month: input.month, finalPayable: result.finalPayable },
  });

  return calc;
}

export async function updateCalculation(
  id: string,
  input: UpdateCalculationInput,
  actorId: string,
) {
  const existing = await prisma.commissionCalculation.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Calculation not found');
  // Editable while DRAFT, or REJECTED (so it can be fixed and resubmitted).
  // SUBMITTED/APPROVED are locked to preserve the audit trail.
  if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
    throw ApiError.conflict('Only DRAFT or REJECTED calculations can be edited');
  }

  // Merge the update over the existing record, then recompute from scratch.
  const merged: CreateCalculationInput = {
    vendorId: input.vendorId ?? existing.vendorId,
    month: input.month ?? existing.month,
    billingPeriod: input.billingPeriod ?? existing.billingPeriod ?? undefined,
    totalSales: input.totalSales ?? Number(existing.totalSales),
    gstPercentage: input.gstPercentage,
    zones:
      input.zones ??
      (await prisma.commissionZoneBreakdown.findMany({ where: { calculationId: id } })).map((b) => ({
        zoneId: b.zoneId!,
        zoneType: b.zoneType!,
        commissionPercentage: Number(b.commissionPercentage),
      })),
  };

  const { engineInput, snapshot } = await buildComputation(merged);
  const result = computeCommission(engineInput);

  const calc = await prisma.$transaction(async (tx) => {
    await tx.commissionZoneBreakdown.deleteMany({ where: { calculationId: id } });
    return tx.commissionCalculation.update({
      where: { id },
      data: {
        ...snapshot,
        totalSales: merged.totalSales,
        agrAmount: result.agrAmount,
        salesAfterAgr: result.salesAfterAgr,
        grossCommission: result.grossCommission,
        gstAmount: result.gstAmount,
        tdsAmount: result.tdsAmount,
        fixedPayAmount: result.fixedPayAmount,
        finalPayable: result.finalPayable,
        breakdowns: {
          create: result.breakdowns.map((b) => ({
            zoneId: b.zoneId,
            zoneName: b.zoneName,
            zoneType: b.zoneType,
            commissionPercentage: b.commissionPercentage,
            baseAmount: b.baseAmount,
            commissionAmount: b.commissionAmount,
          })),
        },
      },
      include: calcInclude,
    });
  });

  await writeAudit({
    userId: actorId,
    action: 'CALCULATION_UPDATED',
    entityType: 'CommissionCalculation',
    entityId: id,
    metadata: {
      changes: diffChanges(existing as unknown as Record<string, unknown>, {
        month: merged.month,
        totalSales: merged.totalSales,
        finalPayable: result.finalPayable,
        grossCommission: result.grossCommission,
      }),
    },
  });

  return calc;
}

export async function listCalculations(query: ListCalculationsQuery) {
  const { page, pageSize, vendorId, status, month, search } = query;
  const where: Prisma.CommissionCalculationWhereInput = {
    ...(vendorId ? { vendorId } : {}),
    ...(status ? { status } : {}),
    ...(month ? { month } : {}),
    // Search matches the vendor's name or company name.
    ...(search
      ? {
          vendor: {
            is: {
              OR: [
                { vendorName: { contains: search, mode: 'insensitive' } },
                { companyName: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.commissionCalculation.findMany({
      where,
      include: {
        vendor: { select: { id: true, vendorName: true, companyName: true } },
        _count: { select: { breakdowns: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.commissionCalculation.count({ where }),
  ]);

  return { items, meta: pageMeta(page, pageSize, total) };
}

// Distinct calculation months (desc) for the month filter dropdown.
export async function listCalculationMonths() {
  const groups = await prisma.commissionCalculation.groupBy({
    by: ['month'],
    orderBy: { month: 'desc' },
  });
  return groups.map((g) => g.month);
}

export async function getCalculation(id: string) {
  const calc = await prisma.commissionCalculation.findUnique({ where: { id }, include: calcInclude });
  if (!calc) throw ApiError.notFound('Calculation not found');
  return calc;
}

// Any status is deletable (Admin only, enforced at the route). Approved calcs
// may carry a bill (FK RESTRICTs the delete) and receipts with stored files, so
// the delete removes the bill in the same transaction and then best-effort
// cleans up stored files (bill PDF + receipt attachments). Breakdowns,
// approvals, and payments cascade via the schema.
async function destroyCalculation(id: string) {
  const existing = await prisma.commissionCalculation.findUnique({
    where: { id },
    include: {
      bill: { select: { id: true, billNumber: true, pdfPath: true } },
      payments: { select: { attachmentPath: true } },
    },
  });
  if (!existing) return null;

  await prisma.$transaction(async (tx) => {
    if (existing.bill) await tx.bill.delete({ where: { id: existing.bill.id } });
    await tx.commissionCalculation.delete({ where: { id } });
  });

  // Storage cleanup after commit; a failed file delete never breaks the API call.
  const files = [
    existing.bill?.pdfPath,
    ...existing.payments.map((p) => p.attachmentPath),
  ].filter((f): f is string => !!f);
  await Promise.allSettled(files.map((f) => storage.delete(f)));

  return { status: existing.status, billNumber: existing.bill?.billNumber ?? null };
}

export async function deleteCalculation(id: string, actorId: string) {
  const deleted = await destroyCalculation(id);
  if (!deleted) throw ApiError.notFound('Calculation not found');
  await writeAudit({
    userId: actorId,
    action: 'CALCULATION_DELETED',
    entityType: 'CommissionCalculation',
    entityId: id,
    metadata: { status: deleted.status, billNumber: deleted.billNumber },
  });
  return { id };
}

// Best-effort bulk delete: rows already gone are skipped and reported, not
// fatal — the client's table is a snapshot.
export async function bulkDeleteCalculations(ids: string[], actorId: string) {
  const deleted: { id: string; status: string; billNumber: string | null }[] = [];
  const skippedIds: string[] = [];
  for (const id of ids) {
    const result = await destroyCalculation(id);
    if (result) deleted.push({ id, ...result });
    else skippedIds.push(id);
  }

  if (deleted.length > 0) {
    await writeAudit({
      userId: actorId,
      action: 'CALCULATIONS_BULK_DELETED',
      entityType: 'CommissionCalculation',
      metadata: { deleted, skippedIds },
    });
  }

  return { deletedCount: deleted.length, skippedIds };
}

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit, diffChanges } from '../../lib/audit.js';
import { pageMeta } from '../../utils/apiResponse.js';
import type {
  CreateVendorInput,
  ListVendorsQuery,
  UpdateVendorInput,
} from './vendor.schema.js';

const vendorInclude = { bankDetails: true } satisfies Prisma.VendorInclude;
// Detail view also returns the vendor's zone assignments (with the master zone).
const vendorDetailInclude = {
  bankDetails: true,
  documents: true,
  zoneAssignments: { include: { zone: true }, orderBy: [{ zoneType: 'asc' }] },
} satisfies Prisma.VendorInclude;

// Normalise "" -> undefined so an empty optional email doesn't fail persistence.
function blankToUndef<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === '') (out as Record<string, unknown>)[k] = undefined;
  }
  return out;
}

export async function createVendor(input: CreateVendorInput, actorId: string) {
  const { bankDetails, zoneAssignments, ...data } = blankToUndef(input);
  // Fixed pay amount is meaningless when the toggle is off — store NULL.
  if (!data.fixedPayEnabled) data.fixedPayAmount = null;

  const vendor = await prisma.vendor.create({
    data: {
      ...data,
      createdById: actorId,
      bankDetails: bankDetails ? { create: bankDetails } : undefined,
      zoneAssignments: zoneAssignments?.length
        ? {
            create: zoneAssignments.map((a) => ({
              zoneId: a.zoneId,
              zoneType: a.zoneType,
              commissionPercentage: a.commissionPercentage,
            })),
          }
        : undefined,
    },
    include: vendorDetailInclude,
  });

  await writeAudit({
    userId: actorId,
    action: 'VENDOR_CREATED',
    entityType: 'Vendor',
    entityId: vendor.id,
    metadata: { vendorName: vendor.vendorName },
  });

  return vendor;
}

export async function listVendors(query: ListVendorsQuery) {
  const { page, pageSize, search, status, sortBy, sortDir } = query;

  const where: Prisma.VendorWhereInput = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { vendorName: { contains: search, mode: 'insensitive' } },
            { companyName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { mobileNumber: { contains: search, mode: 'insensitive' } },
            { panNumber: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include: vendorInclude,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendor.count({ where }),
  ]);

  return { items, meta: pageMeta(page, pageSize, total) };
}

export async function getVendor(id: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: vendorDetailInclude,
  });
  if (!vendor) throw ApiError.notFound('Vendor not found');
  return vendor;
}

export async function updateVendor(id: string, input: UpdateVendorInput, actorId: string) {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Vendor not found');

  const { bankDetails, zoneAssignments, ...data } = blankToUndef(input);
  // Explicitly disabling fixed pay clears the amount.
  if (data.fixedPayEnabled === false) data.fixedPayAmount = null;

  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      ...data,
      // Upsert bank details so partial updates don't wipe the existing record.
      bankDetails: bankDetails
        ? { upsert: { create: bankDetails, update: bankDetails } }
        : undefined,
      // Replace the whole assignment set when provided (delete all, re-create).
      zoneAssignments: zoneAssignments
        ? {
            deleteMany: {},
            create: zoneAssignments.map((a) => ({
              zoneId: a.zoneId,
              zoneType: a.zoneType,
              commissionPercentage: a.commissionPercentage,
            })),
          }
        : undefined,
    },
    include: vendorDetailInclude,
  });

  await writeAudit({
    userId: actorId,
    action: 'VENDOR_UPDATED',
    entityType: 'Vendor',
    entityId: vendor.id,
    metadata: {
      changed: Object.keys(data),
      changes: diffChanges(existing as unknown as Record<string, unknown>, data),
      ...(bankDetails ? { bankDetailsUpdated: true } : {}),
      ...(zoneAssignments ? { zoneAssignmentsReplaced: zoneAssignments.length } : {}),
    },
  });

  return vendor;
}

export async function deleteVendor(id: string, actorId: string) {
  const existing = await prisma.vendor.findUnique({
    where: { id },
    include: { _count: { select: { calculations: true, bills: true } } },
  });
  if (!existing) throw ApiError.notFound('Vendor not found');

  // Guard against destroying financial history: a vendor with calculations or
  // bills can't be hard-deleted — deactivate instead.
  if (existing._count.calculations > 0 || existing._count.bills > 0) {
    throw ApiError.conflict(
      'Vendor has calculations or bills and cannot be deleted. Set status to INACTIVE instead.',
    );
  }

  await prisma.vendor.delete({ where: { id } });

  await writeAudit({
    userId: actorId,
    action: 'VENDOR_DELETED',
    entityType: 'Vendor',
    entityId: id,
    metadata: { vendorName: existing.vendorName },
  });

  return { id };
}

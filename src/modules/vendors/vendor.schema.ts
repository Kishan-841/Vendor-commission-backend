import { z } from 'zod';

// Percentages accepted as 0–100 (e.g. 8 = 8%). Stored as Decimal(7,4).
const percentage = z.coerce.number().min(0).max(100);

const bankDetailSchema = z.object({
  bankName: z.string().trim().min(1).optional(),
  accountHolder: z.string().trim().min(1).optional(),
  accountNumber: z.string().trim().min(1).optional(),
  ifscCode: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
});

// One assignment = a master zone under a type (NEW/RENEWAL) with its commission %.
const zoneAssignmentSchema = z.object({
  zoneId: z.string().min(1),
  zoneType: z.enum(['NEW', 'RENEWAL']),
  commissionPercentage: z.coerce.number().min(0).max(100),
});

export const createVendorSchema = z
  .object({
    companyName: z.string().trim().min(1).optional(),
    vendorName: z.string().trim().min(1, 'Vendor name is required'),
    address: z.string().trim().optional(),
    mobileNumber: z.string().trim().optional(),
    email: z.string().email().optional().or(z.literal('')),
    panNumber: z.string().trim().optional(),
    gstNumber: z.string().trim().optional(),
    agrApplicable: z.boolean().default(false),
    agrPercentage: percentage.default(0),
    tdsPercentage: percentage.default(0),
    // Fixed Vendor Pay: flat amount added to (positive) or deducted from
    // (negative) the performance pay before taxes.
    fixedPayEnabled: z.boolean().default(false),
    fixedPayAmount: z.coerce.number().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
    bankDetails: bankDetailSchema.optional(),
    // Zone assignments (each: zone + type + commission %).
    zoneAssignments: z.array(zoneAssignmentSchema).optional(),
  })
  // AGR% only makes sense when AGR applies.
  .refine((v) => !v.agrApplicable || v.agrPercentage > 0, {
    message: 'AGR percentage must be greater than 0 when AGR is applicable',
    path: ['agrPercentage'],
  })
  // Fixed pay amount is required (non-zero, may be negative) when enabled —
  // a zero amount means the toggle should just be off.
  .refine((v) => !v.fixedPayEnabled || (v.fixedPayAmount != null && v.fixedPayAmount !== 0), {
    message: 'Fixed pay amount is required when Fixed Vendor Pay is enabled',
    path: ['fixedPayAmount'],
  });

// Update: all fields optional, but keep the cross-field rules when the relevant
// fields are present.
export const updateVendorSchema = z
  .object({
    companyName: z.string().trim().min(1).nullable().optional(),
    vendorName: z.string().trim().min(1).optional(),
    address: z.string().trim().nullable().optional(),
    mobileNumber: z.string().trim().nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal('')),
    panNumber: z.string().trim().nullable().optional(),
    gstNumber: z.string().trim().nullable().optional(),
    agrApplicable: z.boolean().optional(),
    agrPercentage: percentage.optional(),
    tdsPercentage: percentage.optional(),
    fixedPayEnabled: z.boolean().optional(),
    fixedPayAmount: z.coerce.number().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    bankDetails: bankDetailSchema.optional(),
    // When provided, REPLACES the vendor's full set of zone assignments.
    zoneAssignments: z.array(zoneAssignmentSchema).optional(),
  })
  .refine((v) => v.fixedPayEnabled !== true || (v.fixedPayAmount != null && v.fixedPayAmount !== 0), {
    message: 'Fixed pay amount is required when Fixed Vendor Pay is enabled',
    path: ['fixedPayAmount'],
  })
  .refine((v) => v.agrApplicable !== true || (v.agrPercentage ?? 1) > 0, {
    message: 'AGR percentage must be greater than 0 when AGR is applicable',
    path: ['agrPercentage'],
  });

export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sortBy: z.enum(['createdAt', 'vendorName']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const idParamSchema = z.object({ id: z.string().min(1) });

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

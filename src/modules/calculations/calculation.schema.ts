import { z } from 'zod';

const zoneSelectionSchema = z.object({
  zoneId: z.string().min(1),
  zoneType: z.enum(['NEW', 'RENEWAL']),
  commissionPercentage: z.coerce.number().min(0).max(100),
});

export const createCalculationSchema = z.object({
  vendorId: z.string().min(1, 'vendorId is required'),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format'),
  billingPeriod: z.string().trim().optional(),
  totalSales: z.coerce.number().nonnegative(),
  zones: z.array(zoneSelectionSchema).min(1, 'Select at least one zone'),
  // Optional override; when omitted, GST is derived from the vendor's GST number.
  gstPercentage: z.coerce.number().min(0).max(100).optional(),
});

// Only DRAFT calculations can be edited; same shape as create.
export const updateCalculationSchema = createCalculationSchema.partial().extend({
  zones: z.array(zoneSelectionSchema).min(1).optional(),
});

export const listCalculationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  vendorId: z.string().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const idParamSchema = z.object({ id: z.string().min(1) });

export type CreateCalculationInput = z.infer<typeof createCalculationSchema>;
export type UpdateCalculationInput = z.infer<typeof updateCalculationSchema>;
export type ListCalculationsQuery = z.infer<typeof listCalculationsQuerySchema>;

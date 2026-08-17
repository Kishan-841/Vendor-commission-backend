import { z } from 'zod';

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format');

export const zoneCommissionQuerySchema = z.object({
  month: monthSchema,
  sortBy: z
    .enum(['zone', 'totalSales', 'totalOrders', 'commissionPercentage', 'commissionAmount'])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const zoneCommissionExportQuerySchema = z.object({ month: monthSchema });

export const vendorCommissionQuerySchema = z.object({
  month: monthSchema,
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Export ignores pagination — all matching rows land in the workbook.
export const vendorCommissionExportQuerySchema = z.object({
  month: monthSchema,
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
});

export type VendorCommissionQuery = z.infer<typeof vendorCommissionQuerySchema>;

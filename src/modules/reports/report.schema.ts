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

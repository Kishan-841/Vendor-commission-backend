import { z } from 'zod';

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format');

// Tab 1 — upload. New and Renewal are uploaded separately (salesType). `replace`
// (admin-only) confirms overwriting an existing (month, type) sheet.
export const uploadBodySchema = z.object({
  month: monthSchema,
  salesType: z.enum(['NEW', 'RENEWAL']),
  replace: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const idParamSchema = z.object({ id: z.string().min(1) });

// Tab 2 — calculations from a stored sheet.
export const generateVendorBodySchema = z.object({
  month: monthSchema,
  vendorId: z.string().min(1, 'vendorId is required'),
});

export const generateAllBodySchema = z.object({ month: monthSchema });

export const generateVendorsBodySchema = z.object({
  month: monthSchema,
  vendorIds: z.array(z.string().min(1)).min(1, 'Select at least one vendor'),
});

export const monthQuerySchema = z.object({ month: monthSchema });

export const exportQuerySchema = z.object({
  month: monthSchema,
  vendorId: z.string().min(1, 'vendorId is required'),
});

// GET /sales — Sales Summary listing.
export const salesListQuerySchema = z.object({
  month: monthSchema,
  search: z.string().trim().max(200).optional(),
  salesType: z.enum(['NEW', 'RENEWAL']).optional(),
  zone: z.string().optional(),
  operator: z.string().optional(),
  site: z.string().optional(),
  status: z.string().optional(),
  modeOfRenew: z.string().optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type SalesListQueryInput = z.infer<typeof salesListQuerySchema>;

export const salesFiltersQuerySchema = z.object({ month: monthSchema });

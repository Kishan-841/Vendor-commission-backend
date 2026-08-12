import { z } from 'zod';

export const generateBillSchema = z.object({
  calculationId: z.string().min(1, 'calculationId is required'),
});

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  vendorId: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const idParamSchema = z.object({ id: z.string().min(1) });

export type ListBillsQuery = z.infer<typeof listBillsQuerySchema>;

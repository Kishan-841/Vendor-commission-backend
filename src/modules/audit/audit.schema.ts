import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const listLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  userId: z.string().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  search: z.string().optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
});

export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;

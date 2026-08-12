import { z } from 'zod';

export const listVendorPayoutsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['PENDING', 'PARTIAL', 'PAID']).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const vendorIdParamSchema = z.object({ vendorId: z.string().min(1) });
export const idParamSchema = z.object({ id: z.string().min(1) });

export const recordPaymentBodySchema = z.object({
  paidAmount: z.coerce.number().positive('Paid amount must be greater than zero'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paymentDate must be YYYY-MM-DD'),
  paymentMode: z.enum(['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER']).default('BANK_TRANSFER'),
  paymentReference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentBodySchema>;

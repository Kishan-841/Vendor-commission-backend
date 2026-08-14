import { z } from 'zod';

export const idParamSchema = z.object({ id: z.string().min(1) });

// Remarks optional on submit/approve, REQUIRED on reject (must explain why).
export const remarksOptionalSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

export const rejectSchema = z.object({
  remarks: z.string().trim().min(1, 'A reason is required when rejecting'),
});

// Bulk submit/approve take a list of calculation ids.
export const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one calculation').max(100),
});

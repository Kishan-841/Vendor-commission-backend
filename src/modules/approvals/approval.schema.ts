import { z } from 'zod';

export const idParamSchema = z.object({ id: z.string().min(1) });

// Remarks optional on submit/approve, REQUIRED on reject (must explain why).
export const remarksOptionalSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

export const rejectSchema = z.object({
  remarks: z.string().trim().min(1, 'A reason is required when rejecting'),
});

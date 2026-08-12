import { z } from 'zod';

export const uploadZonesBodySchema = z.object({
  // When "true", the entire master zone list is replaced by this upload.
  replace: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const listZonesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().trim().optional(),
});

export const renameZoneSchema = z.object({
  name: z.string().trim().min(1, 'Zone name is required'),
});

// Create a single master zone by name (alongside the bulk Excel upload).
export const createZoneSchema = z.object({
  name: z.string().trim().min(1, 'Zone name is required'),
});

export const idParamSchema = z.object({ id: z.string().min(1) });

export type UploadZonesBody = z.infer<typeof uploadZonesBodySchema>;
export type ListZonesQuery = z.infer<typeof listZonesQuerySchema>;

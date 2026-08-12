import type { Response } from 'express';

// Consistent envelope for every successful response so the frontend can rely
// on a single shape: { success: true, data, meta? }.
export function ok<T>(res: Response, data: T, status = 200, meta?: unknown) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

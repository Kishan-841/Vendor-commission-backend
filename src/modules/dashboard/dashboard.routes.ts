import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { getDashboardStats } from './dashboard.service.js';

const statsQuerySchema = z.object({
  months: z.coerce.number().int().refine((v) => v === 6 || v === 12, 'months must be 6 or 12').default(6),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional(),
});

// Mounted under /api/dashboard — a single stats endpoint feeds the whole
// Overview page (cards, charts, tables). Small module, so routes+controller
// live together here.
export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get(
  '/stats',
  validate({ query: statsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { months, month } = req.query as unknown as { months: number; month?: string };
    return ok(res, await getDashboardStats(months, month));
  }),
);

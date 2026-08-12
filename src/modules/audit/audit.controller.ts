import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import * as auditService from './audit.service.js';

export const listLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await auditService.listLogs(req.query as never);
  return ok(res, items, 200, meta);
});

export const logFiltersHandler = asyncHandler(async (_req: Request, res: Response) => {
  const filters = await auditService.getLogFilters();
  return ok(res, filters);
});

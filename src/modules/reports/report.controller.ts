import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { getZoneCommissionReport, buildZoneCommissionWorkbook } from './report.service.js';

export const zoneCommissionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month, sortBy, sortOrder } = req.query as unknown as {
    month: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  };
  return ok(res, await getZoneCommissionReport(month, sortBy, sortOrder));
});

export const zoneCommissionExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month } = req.query as unknown as { month: string };
  const { buffer, fileName } = await buildZoneCommissionWorkbook(month);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { writeAudit } from '../../lib/audit.js';
import {
  getZoneCommissionReport,
  buildZoneCommissionWorkbook,
  getVendorCommissionReport,
  buildVendorCommissionWorkbook,
} from './report.service.js';

export const zoneCommissionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month, sortBy, sortOrder } = req.query as unknown as {
    month: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  };
  return ok(res, await getZoneCommissionReport(month, sortBy, sortOrder));
});

export const vendorCommissionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month, status, page, pageSize } = req.query as unknown as {
    month: string;
    status?: string;
    page: number;
    pageSize: number;
  };
  return ok(res, await getVendorCommissionReport(month, status, page, pageSize));
});

export const vendorCommissionExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month, status } = req.query as unknown as { month: string; status?: string };
  const { buffer, fileName } = await buildVendorCommissionWorkbook(month, status);
  await writeAudit({
    userId: req.user!.id,
    action: 'REPORT_EXPORTED',
    entityType: 'Report',
    metadata: req.query as Record<string, unknown>,
  });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

export const zoneCommissionExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month } = req.query as unknown as { month: string };
  const { buffer, fileName } = await buildZoneCommissionWorkbook(month);
  await writeAudit({
    userId: req.user!.id,
    action: 'REPORT_EXPORTED',
    entityType: 'Report',
    metadata: req.query as Record<string, unknown>,
  });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

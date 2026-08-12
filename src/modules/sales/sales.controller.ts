import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { sendDownload } from '../../utils/sendDownload.js';
import { contentTypeFor } from '../../lib/storage.js';
import { buildVendorMonthWorkbook } from './sales.export.js';
import {
  uploadSalesSheet,
  listSalesUploads,
  setSalesUploadLock,
  deleteSalesUpload,
  getSalesUploadFile,
  getVendorsForMonth,
  generateVendorForMonth,
  generateSelectedVendors,
  generateAllForMonth,
  listSales,
  listSalesMonths,
  getSalesFilterOptions,
  type SalesListQuery,
} from './sales.service.js';
import type { SalesListQueryInput } from './sales.schema.js';

// ── Tab 1: Upload management ───────────────────────────────────────────────

export const uploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = (req.files as { file?: Express.Multer.File[] } | undefined)?.file?.[0];
  if (!file) throw ApiError.badRequest('Please upload a sales sheet (multipart field "file")');

  const isAdmin = req.user!.role === 'ADMIN';
  // Only admins may replace an existing sheet.
  if (req.body.replace && !isAdmin) throw ApiError.forbidden('Only an admin can replace a sales sheet');

  const result = await uploadSalesSheet(
    req.body.month,
    req.body.salesType,
    file,
    req.user!.id,
    isAdmin,
    req.body.replace,
  );
  return ok(res, result, 201);
});

export const listUploadsHandler = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, await listSalesUploads());
});

export const unlockHandler = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await setSalesUploadLock(req.params.id, false, req.user!.id));
});

export const lockHandler = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await setSalesUploadLock(req.params.id, true, req.user!.id));
});

export const deleteUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteSalesUpload(req.params.id, req.user!.id);
  return ok(res, { deleted: true });
});

export const downloadUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const { stream, contentLength, fileName } = await getSalesUploadFile(req.params.id);
  sendDownload(res, stream, { fileName, contentType: contentTypeFor(fileName), contentLength });
});

// ── Tab 2: Calculations from a stored sheet ────────────────────────────────

export const vendorsForMonthHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month } = req.query as unknown as { month: string };
  return ok(res, await getVendorsForMonth(month));
});

export const generateVendorHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateVendorForMonth(req.body.month, req.body.vendorId, req.user!.id);
  return ok(res, result, 201);
});

export const generateVendorsHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateSelectedVendors(req.body.month, req.body.vendorIds, req.user!.id);
  return ok(res, result, 201);
});

export const generateAllHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await generateAllForMonth(req.body.month, req.user!.id);
  return ok(res, result, 201);
});

// ── Sales Summary ──────────────────────────────────────────────────────────

export const listMonthsHandler = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, await listSalesMonths());
});

export const listSalesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as SalesListQueryInput;
  return ok(res, await listSales(query as SalesListQuery));
});

export const filterOptionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month } = req.query as unknown as { month: string };
  return ok(res, await getSalesFilterOptions(month));
});

// Vendor + month Excel export (two sheets: Sales Summary + Sales Zone Data).
export const exportWorkbookHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month, vendorId } = req.query as unknown as { month: string; vendorId: string };
  const { buffer, fileName } = await buildVendorMonthWorkbook(month, vendorId, req.user!.id);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

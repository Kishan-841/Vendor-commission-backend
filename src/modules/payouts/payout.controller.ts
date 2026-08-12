import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { PayoutStatus } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { env } from '../../config/env.js';
import {
  listVendorPayouts,
  listPayoutMonths,
  getVendorPayoutDetail,
  getVendorLedger,
  recordPayment,
  updatePayment,
  deletePayment,
  getPaymentAttachment,
  generatePaymentReceipt,
  generateVendorLedgerPdf,
  exportPayoutsCsv,
} from './payout.service.js';

// Persist an uploaded receipt attachment to UPLOAD_DIR/receipts and return its path.
function saveAttachment(file: Express.Multer.File): string {
  const dir = path.resolve(env.UPLOAD_DIR, 'receipts');
  fs.mkdirSync(dir, { recursive: true });
  const safe = file.originalname.replace(/[^\w.\- ]/g, '_');
  const filePath = path.join(dir, `${Date.now()}__${safe}`);
  fs.writeFileSync(filePath, file.buffer);
  return filePath;
}

export const listVendorPayoutsHandler = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as unknown as {
    search?: string;
    status?: PayoutStatus;
    month?: string;
    page: number;
    pageSize: number;
  };
  const { items, meta, totals } = await listVendorPayouts(q);
  return ok(res, { items, totals }, 200, meta);
});

export const listPayoutMonthsHandler = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, await listPayoutMonths());
});

export const vendorPayoutDetailHandler = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await getVendorPayoutDetail(req.params.vendorId));
});

export const vendorLedgerHandler = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await getVendorLedger(req.params.vendorId));
});

export const recordPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file ? saveAttachment(req.file) : null;
  const result = await recordPayment(req.params.id, req.body, req.user!.id, file);
  return ok(res, result, 201);
});

export const updatePaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  // Only replace the attachment when a new file is uploaded (undefined = keep).
  const attachment = req.file ? saveAttachment(req.file) : undefined;
  const result = await updatePayment(req.params.id, req.body, req.user!.id, attachment);
  return ok(res, result);
});

export const deletePaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  await deletePayment(req.params.id, req.user!.id);
  return ok(res, { deleted: true });
});

export const paymentAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, fileName } = await getPaymentAttachment(req.params.id);
  // Serve user-uploaded files as a download with a neutral type + no sniffing,
  // so a malicious upload can never be rendered (stored XSS) by the browser.
  const safeName = fileName.replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(path.resolve(filePath));
});

export const paymentReceiptHandler = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, receiptNumber } = await generatePaymentReceipt(req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${receiptNumber}.pdf"`);
  res.sendFile(path.resolve(filePath));
});

export const vendorLedgerPdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, fileName } = await generateVendorLedgerPdf(req.params.vendorId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.sendFile(path.resolve(filePath));
});

export const exportPayoutsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const csv = await exportPayoutsCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="vendor-payouts.csv"');
  res.send('﻿' + csv); // BOM so Excel opens ₹/UTF-8 columns correctly
});

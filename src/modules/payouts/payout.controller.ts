import type { Request, Response } from 'express';
import type { PayoutStatus } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { sendDownload } from '../../utils/sendDownload.js';
import { storage, contentTypeFor, safeFilePart } from '../../lib/storage.js';
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

// Persist an uploaded receipt attachment to object storage; returns its key.
async function saveAttachment(file: Express.Multer.File): Promise<string> {
  const key = `receipts/${Date.now()}__${safeFilePart(file.originalname)}`;
  await storage.put(key, file.buffer, contentTypeFor(file.originalname));
  return key;
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
  const file = req.file ? await saveAttachment(req.file) : null;
  const result = await recordPayment(req.params.id, req.body, req.user!.id, file);
  return ok(res, result, 201);
});

export const updatePaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  // Only replace the attachment when a new file is uploaded (undefined = keep).
  const attachment = req.file ? await saveAttachment(req.file) : undefined;
  const result = await updatePayment(req.params.id, req.body, req.user!.id, attachment);
  return ok(res, result);
});

export const deletePaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  await deletePayment(req.params.id, req.user!.id);
  return ok(res, { deleted: true });
});

export const paymentAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { stream, contentLength, fileName } = await getPaymentAttachment(req.params.id);
  // User-uploaded file → neutral type + no sniffing so it can never be rendered
  // (stored XSS) by the browser; always a download.
  sendDownload(res, stream, { fileName, contentType: 'application/octet-stream', contentLength });
});

export const paymentReceiptHandler = asyncHandler(async (req: Request, res: Response) => {
  const { buffer, receiptNumber } = await generatePaymentReceipt(req.params.id);
  sendDownload(res, buffer, { fileName: `${receiptNumber}.pdf`, contentType: 'application/pdf' });
});

export const vendorLedgerPdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const { buffer, fileName } = await generateVendorLedgerPdf(req.params.vendorId);
  sendDownload(res, buffer, { fileName, contentType: 'application/pdf' });
});

export const exportPayoutsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const csv = await exportPayoutsCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="vendor-payouts.csv"');
  res.send('﻿' + csv); // BOM so Excel opens ₹/UTF-8 columns correctly
});

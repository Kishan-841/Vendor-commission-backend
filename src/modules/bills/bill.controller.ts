import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { sendDownload } from '../../utils/sendDownload.js';
import * as billService from './bill.service.js';

export const generateBillHandler = asyncHandler(async (req: Request, res: Response) => {
  const bill = await billService.generateBill(req.body.calculationId, req.user!.id);
  return ok(res, bill, 201);
});

export const listBillsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await billService.listBills(req.query as never);
  return ok(res, items, 200, meta);
});

export const getBillHandler = asyncHandler(async (req: Request, res: Response) => {
  const bill = await billService.getBill(req.params.id);
  return ok(res, bill);
});

// Streams the generated PDF (from object storage) as an attachment.
export const downloadBillHandler = asyncHandler(async (req: Request, res: Response) => {
  const { stream, contentLength, fileName } = await billService.getBillForDownload(req.params.id);
  sendDownload(res, stream, { fileName, contentType: 'application/pdf', contentLength });
});

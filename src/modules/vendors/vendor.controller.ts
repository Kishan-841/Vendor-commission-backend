import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import * as vendorService from './vendor.service.js';

export const createVendorHandler = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await vendorService.createVendor(req.body, req.user!.id);
  return ok(res, vendor, 201);
});

export const listVendorsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await vendorService.listVendors(req.query as never);
  return ok(res, items, 200, meta);
});

export const getVendorHandler = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await vendorService.getVendor(req.params.id);
  return ok(res, vendor);
});

export const updateVendorHandler = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await vendorService.updateVendor(req.params.id, req.body, req.user!.id);
  return ok(res, vendor);
});

export const deleteVendorHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await vendorService.deleteVendor(req.params.id, req.user!.id);
  return ok(res, result);
});

import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import * as zoneService from './zone.service.js';

export const uploadZonesHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded (field name must be "file")');
  const result = await zoneService.uploadZones(req.file, req.body, req.user!.id);
  return ok(res, result, 201);
});

export const createZoneHandler = asyncHandler(async (req: Request, res: Response) => {
  const zone = await zoneService.createZone(req.body.name, req.user!.id);
  return ok(res, zone, 201);
});

export const listZonesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await zoneService.listZones(req.query as never);
  return ok(res, items, 200, meta);
});

export const listUploadsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const uploads = await zoneService.listUploads();
  return ok(res, uploads);
});

export const renameZoneHandler = asyncHandler(async (req: Request, res: Response) => {
  const zone = await zoneService.renameZone(req.params.id, req.body.name, req.user!.id);
  return ok(res, zone);
});

export const deleteZoneHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await zoneService.deleteZone(req.params.id, req.user!.id);
  return ok(res, result);
});

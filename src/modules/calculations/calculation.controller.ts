import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import * as calcService from './calculation.service.js';

export const createCalculationHandler = asyncHandler(async (req: Request, res: Response) => {
  const calc = await calcService.createCalculation(req.body, req.user!.id);
  return ok(res, calc, 201);
});

export const listCalculationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await calcService.listCalculations(req.query as never);
  return ok(res, items, 200, meta);
});

export const listCalculationMonthsHandler = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, await calcService.listCalculationMonths());
});

export const calculationConfigHandler = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, await calcService.getCalculationConfig());
});

export const getCalculationHandler = asyncHandler(async (req: Request, res: Response) => {
  const calc = await calcService.getCalculation(req.params.id);
  return ok(res, calc);
});

export const updateCalculationHandler = asyncHandler(async (req: Request, res: Response) => {
  const calc = await calcService.updateCalculation(req.params.id, req.body, req.user!.id);
  return ok(res, calc);
});

export const deleteCalculationHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await calcService.deleteCalculation(req.params.id, req.user!.id);
  return ok(res, result);
});

export const bulkDeleteCalculationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await calcService.bulkDeleteCalculations(req.body.ids, req.user!.id);
  return ok(res, result);
});

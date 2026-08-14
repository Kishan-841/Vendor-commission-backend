import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import * as approvalService from './approval.service.js';

export const submitHandler = asyncHandler(async (req: Request, res: Response) => {
  const calc = await approvalService.submitCalculation(req.params.id, req.user!.id, req.body?.remarks);
  return ok(res, calc);
});

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  const calc = await approvalService.approveCalculation(req.params.id, req.user!.id, req.body?.remarks);
  return ok(res, calc);
});

export const rejectHandler = asyncHandler(async (req: Request, res: Response) => {
  const calc = await approvalService.rejectCalculation(req.params.id, req.user!.id, req.body.remarks);
  return ok(res, calc);
});

export const bulkSubmitHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvalService.bulkSubmitCalculations(req.body.ids, req.user!.id);
  return ok(res, result);
});

export const bulkApproveHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvalService.bulkApproveCalculations(req.body.ids, req.user!.id);
  return ok(res, result);
});

export const historyHandler = asyncHandler(async (req: Request, res: Response) => {
  const history = await approvalService.getApprovalHistory(req.params.id);
  return ok(res, history);
});

import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import * as authService from './auth.service.js';

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body);
  return ok(res, result);
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  const profile = await authService.getProfile(req.user!.id);
  return ok(res, profile);
});

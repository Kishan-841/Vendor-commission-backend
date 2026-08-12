import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { isProd } from '../config/env.js';

// 404 fallthrough for unmatched routes.
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound('Route not found'));
}

// Central error handler. Translates known error shapes (ApiError, Prisma) into
// clean JSON; anything else becomes a 500 with the stack hidden in production.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Prisma unique-constraint violation -> 409 Conflict
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return res.status(409).json({ success: false, message: `Duplicate value for ${target}` });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  return res.status(500).json({
    success: false,
    message: isProd ? 'Internal server error' : message,
  });
}

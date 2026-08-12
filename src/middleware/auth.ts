import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyToken } from '../lib/jwt.js';
import { ApiError } from '../utils/ApiError.js';

// Require a valid Bearer token. Populates req.user for downstream handlers.
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
}

// Restrict a route to specific roles. Use after authenticate.
// Note: ADMIN is a superset of FINANCE for everything FINANCE can do, but we
// keep the check explicit so intent is visible at each route.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}

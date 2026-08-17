import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../utils/ApiError.js';

// Require a valid Bearer token. Populates req.user for downstream handlers.
// The user is re-checked against the DB on every request (status + CURRENT
// role, not the token's snapshot) so deactivating or demoting a user takes
// effect immediately instead of at token expiry.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  const token = header.slice('Bearer '.length).trim();
  let sub: string;
  try {
    sub = verifyToken(token).sub;
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, email: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return next(ApiError.unauthorized('Account is inactive or no longer exists'));
    }
    req.user = { id: user.id, role: user.role, email: user.email };
    next();
  } catch (err) {
    next(err);
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

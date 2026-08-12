import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

// Per-request context so deep service code (e.g. writeAudit) can read the
// client IP without threading `req` through every function signature.
interface RequestContext {
  ip?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function requestContext(req: Request, _res: Response, next: NextFunction) {
  als.run({ ip: req.ip }, () => next());
}

export function currentIp(): string | undefined {
  return als.getStore()?.ip;
}

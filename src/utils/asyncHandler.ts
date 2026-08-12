import type { NextFunction, Request, Response } from 'express';

// Express 4 doesn't catch rejected promises from async handlers. This wrapper
// forwards any thrown/rejected error to the error-handling middleware so we
// never have to write try/catch in every controller.
export const asyncHandler =
  <T extends Request = Request>(
    fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
  ) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };

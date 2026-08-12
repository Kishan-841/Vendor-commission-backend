import type { Role } from '@prisma/client';

// Augment Express's Request so `req.user` is typed everywhere after the
// authenticate middleware runs.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        email: string;
      };
    }
  }
}

export {};

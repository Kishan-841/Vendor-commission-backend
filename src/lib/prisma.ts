import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env.js';

// Reuse a single PrismaClient across the process. In dev, tsx watch can reload
// the module, so we stash the client on globalThis to avoid exhausting the
// connection pool with a new client on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;

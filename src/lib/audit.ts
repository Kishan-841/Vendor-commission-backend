import { prisma } from './prisma.js';

// Fire-and-forget-ish audit logging. We await it inside the same transaction
// scope where it matters, but a failed audit write should never break the main
// operation, so callers can ignore rejection for non-critical paths.
export async function writeAudit(input: {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as object | undefined,
    },
  });
}

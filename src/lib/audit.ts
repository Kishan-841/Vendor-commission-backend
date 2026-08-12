import { prisma } from './prisma.js';
import { currentIp } from './request-context.js';

// Fire-and-forget-ish audit logging. We await it inside the same transaction
// scope where it matters, but a failed audit write should never break the main
// operation, so callers can ignore rejection for non-critical paths.
export async function writeAudit(input: {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ip: input.ip ?? currentIp() ?? null,
      metadata: input.metadata as object | undefined,
    },
  });
}

// Shallow diff of an update payload against the existing record, for
// metadata.changes. Only scalar fields present in `after` are considered;
// relation objects/arrays are skipped (callers audit those separately).
// Decimals/Dates are compared by string value so Prisma types don't
// false-positive against plain numbers/ISO strings.
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const norm = (v: unknown): string | null =>
    v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue;
    if (next !== null && typeof next === 'object' && !(next instanceof Date)) continue;
    const prev = before[key];
    if (norm(prev) === norm(next)) continue;
    changes[key] = { from: norm(prev), to: norm(next) };
  }
  return changes;
}

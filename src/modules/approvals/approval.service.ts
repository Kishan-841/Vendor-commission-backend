import type { CalculationStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit } from '../../lib/audit.js';

// Allowed status transitions. Any move not listed here is rejected, so the
// workflow can never enter an invalid state.
const TRANSITIONS: Record<string, CalculationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  REJECTED: ['SUBMITTED'], // resubmit after fixing
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: [], // terminal — a bill can be generated from here
};

async function transition(
  calculationId: string,
  to: CalculationStatus,
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED',
  actorId: string,
  remarks?: string,
) {
  const calc = await prisma.commissionCalculation.findUnique({ where: { id: calculationId } });
  if (!calc) throw ApiError.notFound('Calculation not found');

  const allowed = TRANSITIONS[calc.status] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot move a ${calc.status} calculation to ${to}`);
  }

  // Update status and record the action row atomically — the approvals table is
  // the immutable audit trail (who / when / remarks) for every transition.
  const [updated] = await prisma.$transaction([
    prisma.commissionCalculation.update({ where: { id: calculationId }, data: { status: to } }),
    prisma.approval.create({
      data: { calculationId, action, actorId, remarks: remarks ?? null },
    }),
  ]);

  await writeAudit({
    userId: actorId,
    action: `CALCULATION_${action}`,
    entityType: 'CommissionCalculation',
    entityId: calculationId,
    metadata: { from: calc.status, to, remarks },
  });

  return updated;
}

export function submitCalculation(id: string, actorId: string, remarks?: string) {
  return transition(id, 'SUBMITTED', 'SUBMITTED', actorId, remarks);
}

export function approveCalculation(id: string, actorId: string, remarks?: string) {
  return transition(id, 'APPROVED', 'APPROVED', actorId, remarks);
}

export function rejectCalculation(id: string, actorId: string, remarks: string) {
  return transition(id, 'REJECTED', 'REJECTED', actorId, remarks);
}

export async function getApprovalHistory(calculationId: string) {
  const calc = await prisma.commissionCalculation.findUnique({ where: { id: calculationId } });
  if (!calc) throw ApiError.notFound('Calculation not found');
  return prisma.approval.findMany({
    where: { calculationId },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { id: true, name: true, email: true, role: true } } },
  });
}

// One-time backfill (Aug 2026): round the stored finalPayable of DRAFT and
// REJECTED calculations to the nearest whole rupee, matching the engine's new
// round-off rule. APPROVED/SUBMITTED calcs are left untouched — their amounts
// are locked to the workflow, bills, and payouts.
//
// Run from backend/: npx tsx --env-file=.env scripts/roundoff-backfill.ts
import { prisma } from '../src/lib/prisma.js';
import { writeAudit } from '../src/lib/audit.js';

const calcs = await prisma.commissionCalculation.findMany({
  where: { status: { in: ['DRAFT', 'REJECTED'] } },
  select: { id: true, finalPayable: true },
});

const updated: string[] = [];
for (const c of calcs) {
  const current = Number(c.finalPayable);
  const rounded = Math.round(current);
  if (rounded === current) continue;
  await prisma.commissionCalculation.update({
    where: { id: c.id },
    data: { finalPayable: rounded },
  });
  updated.push(c.id);
  console.log(`${c.id}: ${current} -> ${rounded}`);
}

if (updated.length > 0) {
  await writeAudit({
    action: 'CALCULATIONS_ROUNDOFF_BACKFILL',
    entityType: 'CommissionCalculation',
    metadata: { updatedIds: updated },
  });
}

console.log(`Done: ${updated.length}/${calcs.length} draft/rejected calculations rounded.`);
await prisma.$disconnect();

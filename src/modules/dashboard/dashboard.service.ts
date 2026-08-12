import { prisma } from '../../lib/prisma.js';

const toNum = (d: unknown) => Number(d ?? 0);

// "2026-07" for `back` months before now (back=0 → current month).
function monthKey(back: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// One round trip for the whole dashboard: cards, chart series and tables.
// `months` bounds the time-series (6 or 12). `month` (optional, YYYY-MM) scopes
// every month-dependent metric to that month; vendor/zone counts and the trend
// series stay global.
export async function getDashboardStats(months: number, month?: string) {
  const monthKeys = Array.from({ length: months }, (_, i) => monthKey(months - 1 - i));

  // `month` narrows the month-dependent queries; omitted => all-time.
  const inMonth = month ? { month } : {};
  const calcInMonth = month ? { calculation: { month } } : {};

  const [
    vendorGroups,
    zoneCount,
    pendingApprovals,
    billAgg,
    approvedAgg,
    statusGroups,
    monthlyGroups,
    zoneBreakdowns,
    recentPayments,
    pendingCalcs,
    vendorTotals,
    monthGroups,
  ] = await Promise.all([
    prisma.vendor.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.zone.count(),
    prisma.commissionCalculation.count({ where: { status: 'SUBMITTED', ...inMonth } }),
    prisma.bill.aggregate({
      where: month ? { billingMonth: month } : {},
      _count: { _all: true },
      _sum: { finalPayable: true },
    }),
    prisma.commissionCalculation.aggregate({
      where: { status: 'APPROVED', ...inMonth },
      _sum: { finalPayable: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.commissionCalculation.groupBy({
      by: ['paymentStatus'],
      where: { status: 'APPROVED', ...inMonth },
      _count: { _all: true },
    }),
    prisma.commissionCalculation.groupBy({
      by: ['month'],
      where: { status: 'APPROVED', month: { in: monthKeys } },
      _sum: { totalSales: true, finalPayable: true, paidAmount: true },
    }),
    prisma.commissionZoneBreakdown.groupBy({
      by: ['zoneName'],
      where: { calculation: { status: 'APPROVED', ...inMonth } },
      _sum: { baseAmount: true, commissionAmount: true },
    }),
    prisma.payoutPayment.findMany({
      where: calcInMonth,
      take: 5,
      orderBy: { paymentDate: 'desc' },
      include: {
        calculation: {
          select: { month: true, vendor: { select: { id: true, vendorName: true } } },
        },
      },
    }),
    prisma.commissionCalculation.findMany({
      where: { status: 'APPROVED', paymentStatus: { not: 'PAID' }, ...inMonth },
      include: {
        vendor: { select: { id: true, vendorName: true } },
        approvals: {
          where: { action: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.commissionCalculation.groupBy({
      by: ['vendorId'],
      where: { status: 'APPROVED', ...inMonth },
      _sum: { finalPayable: true, totalSales: true, paidAmount: true },
    }),
    // Distinct months with any calculation activity (drives the month filter).
    prisma.commissionCalculation.groupBy({ by: ['month'], orderBy: { month: 'desc' } }),
  ]);
  const availableMonths = monthGroups.map((g) => g.month);

  // Cards -------------------------------------------------------------------
  const activeVendors = vendorGroups.find((g) => g.status === 'ACTIVE')?._count._all ?? 0;
  const inactiveVendors = vendorGroups.find((g) => g.status === 'INACTIVE')?._count._all ?? 0;
  const totalCommission = toNum(approvedAgg._sum.finalPayable);
  const totalPaid = toNum(approvedAgg._sum.paidAmount);

  // Monthly series ----------------------------------------------------------
  const byMonth = new Map(monthlyGroups.map((g) => [g.month, g]));
  const monthly = monthKeys.map((m) => {
    const g = byMonth.get(m);
    const commission = toNum(g?._sum.finalPayable);
    const paid = toNum(g?._sum.paidAmount);
    return {
      month: m,
      sales: toNum(g?._sum.totalSales),
      commission,
      paid,
      outstanding: Math.max(0, commission - paid),
    };
  });

  // Zone performance (top 8 by sales base) ----------------------------------
  const zonePerformance = zoneBreakdowns
    .map((z) => ({
      zoneName: z.zoneName,
      sales: toNum(z._sum.baseAmount),
      commission: toNum(z._sum.commissionAmount),
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);

  // Pending payouts (largest outstanding first, with days pending) ----------
  const now = Date.now();
  const pendingPayouts = pendingCalcs
    .map((c) => {
      const approvedAt = c.approvals[0]?.createdAt ?? c.updatedAt;
      return {
        calculationId: c.id,
        vendorId: c.vendor.id,
        vendorName: c.vendor.vendorName,
        month: c.month,
        outstanding: Math.max(0, toNum(c.finalPayable) - toNum(c.paidAmount)),
        daysPending: Math.max(0, Math.floor((now - approvedAt.getTime()) / 86400000)),
      };
    })
    .filter((p) => p.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5);

  // Top vendors by commission -----------------------------------------------
  const topVendorIds = vendorTotals
    .sort((a, b) => toNum(b._sum.finalPayable) - toNum(a._sum.finalPayable))
    .slice(0, 5);
  const topVendorInfo = await prisma.vendor.findMany({
    where: { id: { in: topVendorIds.map((v) => v.vendorId) } },
    select: { id: true, vendorName: true },
  });
  const topVendorName = new Map(topVendorInfo.map((v) => [v.id, v.vendorName]));
  const topVendors = topVendorIds.map((v) => ({
    vendorId: v.vendorId,
    vendorName: topVendorName.get(v.vendorId) ?? 'Unknown',
    sales: toNum(v._sum.totalSales),
    commission: toNum(v._sum.finalPayable),
    paid: toNum(v._sum.paidAmount),
  }));

  return {
    availableMonths,
    selectedMonth: month ?? null,
    cards: {
      vendors: { total: activeVendors + inactiveVendors, active: activeVendors, inactive: inactiveVendors },
      zones: zoneCount,
      pendingApprovals,
      bills: { total: billAgg._count._all, amount: toNum(billAgg._sum.finalPayable) },
      commission: {
        total: totalCommission,
        paid: totalPaid,
        outstanding: Math.max(0, totalCommission - totalPaid),
        approvedCount: approvedAgg._count._all,
      },
    },
    paymentStatusDistribution: (['PENDING', 'PARTIAL', 'PAID'] as const).map((s) => ({
      status: s,
      count: statusGroups.find((g) => g.paymentStatus === s)?._count._all ?? 0,
    })),
    monthly,
    zonePerformance,
    recentPayments: recentPayments.map((p) => ({
      paymentId: p.id,
      vendorId: p.calculation.vendor.id,
      vendorName: p.calculation.vendor.vendorName,
      month: p.calculation.month,
      amount: toNum(p.paidAmount),
      paymentDate: p.paymentDate.toISOString(),
      paymentMode: p.paymentMode,
    })),
    pendingPayouts,
    topVendors,
  };
}

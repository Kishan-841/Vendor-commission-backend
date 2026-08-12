import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { pageMeta } from '../../utils/apiResponse.js';
import type { ListLogsQuery } from './audit.schema.js';

export async function listLogs(query: ListLogsQuery) {
  const { page, pageSize, userId, action, entityType, search, dateFrom, dateTo } = query;

  const where: Prisma.AuditLogWhereInput = {
    ...(userId ? { userId } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    // dateTo is inclusive through end of day.
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00`) } : {}),
            ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { entityType: { contains: search, mode: 'insensitive' } },
            { entityId: { contains: search, mode: 'insensitive' } },
            { ip: { contains: search, mode: 'insensitive' } },
            { user: { is: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, meta: pageMeta(page, pageSize, total) };
}

export async function getLogFilters() {
  const [actions, entityTypes, users] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
    prisma.auditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      where: { entityType: { not: null } },
      orderBy: { entityType: 'asc' },
    }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  return {
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entityType).filter((t): t is string => t !== null),
    users,
  };
}

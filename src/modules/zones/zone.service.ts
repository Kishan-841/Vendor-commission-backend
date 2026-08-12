import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit } from '../../lib/audit.js';
import { pageMeta } from '../../utils/apiResponse.js';
import { parseFirstSheet, pickColumn } from '../../lib/excel.js';
import type { ListZonesQuery, UploadZonesBody } from './zone.schema.js';

// Header names we try, in order, to derive a human-readable zone name.
const ZONE_NAME_COLUMNS = ['zone', 'area', 'zone name', 'location'];

// Upload the single master zone sheet. Zones carry no type — the New/Renewal
// type and commission % are set later, per vendor, on the assignment.
export async function uploadZones(
  file: Express.Multer.File,
  body: UploadZonesBody,
  actorId: string,
) {
  const { columns, rows } = parseFirstSheet(file.buffer);
  if (rows.length === 0) {
    throw ApiError.badRequest('The uploaded file has no data rows');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Replace wipes the entire master list (and its vendor assignments cascade).
    if (body.replace) {
      await tx.zone.deleteMany({});
    }

    const upload = await tx.zoneUpload.create({
      data: {
        fileName: file.originalname,
        rowCount: rows.length,
        columns: columns as unknown as Prisma.InputJsonValue,
        uploadedById: actorId,
      },
    });

    await tx.zone.createMany({
      data: rows.map((row, idx) => ({
        uploadId: upload.id,
        name: pickColumn(row, ZONE_NAME_COLUMNS) ?? `Zone ${idx + 1}`,
        zoneData: row as unknown as Prisma.InputJsonValue,
      })),
    });

    return upload;
  });

  await writeAudit({
    userId: actorId,
    action: 'ZONE_EXCEL_UPLOADED',
    entityType: 'ZoneUpload',
    entityId: result.id,
    metadata: { fileName: file.originalname, rows: rows.length, replaced: body.replace },
  });

  return { uploadId: result.id, rowCount: rows.length, columns };
}

// Add a single master zone by name (no Excel). Rejects a case-insensitive
// duplicate so the master list stays clean. `zoneData` mirrors the bulk shape
// with just the zone name; `uploadId` is null (not tied to an upload batch).
export async function createZone(name: string, actorId: string) {
  const existing = await prisma.zone.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (existing) {
    throw ApiError.conflict(`A zone named "${existing.name}" already exists`);
  }

  const zone = await prisma.zone.create({
    data: { name, zoneData: { zone: name } as unknown as Prisma.InputJsonValue },
  });

  await writeAudit({
    userId: actorId,
    action: 'ZONE_CREATED',
    entityType: 'Zone',
    entityId: zone.id,
    metadata: { name },
  });

  return zone;
}

export async function listZones(query: ListZonesQuery) {
  const { page, pageSize, search } = query;
  const where: Prisma.ZoneWhereInput = {
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.zone.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.zone.count({ where }),
  ]);

  return { items, meta: pageMeta(page, pageSize, total) };
}

export async function listUploads() {
  return prisma.zoneUpload.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { zones: true } } },
  });
}

export async function renameZone(id: string, name: string, actorId: string) {
  const existing = await prisma.zone.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Zone not found');

  const zone = await prisma.zone.update({ where: { id }, data: { name } });

  await writeAudit({
    userId: actorId,
    action: 'ZONE_RENAMED',
    entityType: 'Zone',
    entityId: id,
    metadata: { from: existing.name, to: name },
  });

  return zone;
}

export async function deleteZone(id: string, actorId: string) {
  const existing = await prisma.zone.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Zone not found');

  // Vendor assignments cascade-delete; commission breakdowns keep their name
  // snapshot (zoneId set null), so history is preserved.
  await prisma.zone.delete({ where: { id } });

  await writeAudit({
    userId: actorId,
    action: 'ZONE_DELETED',
    entityType: 'Zone',
    entityId: id,
    metadata: { name: existing.name },
  });

  return { id };
}

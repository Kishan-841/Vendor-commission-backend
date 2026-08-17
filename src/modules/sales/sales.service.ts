import { Prisma, type ZoneType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit } from '../../lib/audit.js';
import { storage, contentTypeFor, safeFilePart } from '../../lib/storage.js';
import { getNumberSetting, DEFAULT_GST_KEY } from '../../lib/settings.js';
import {
  parseFirstSheet,
  findColumnKey,
  parseAmount,
  parseAmountOrNull,
  parseSheetDate,
} from '../../lib/excel.js';
import { computeCommissionFromZoneSales, type ZoneSalesInput } from '../calculations/commission.engine.js';

const ZONE_NAME_COLS = ['zone name', 'zone', 'area', 'location', 'zonename'];
const PLAN_AMOUNT_COLS = ['plan amount', 'planamount', 'plan value', 'sales', 'value', 'amount'];
const ACTIVATION_TYPE_COLS = ['activation type', 'activationtype', 'type', 'sales type'];

// ---------------------------------------------------------------------------
// Structured column mapping: every known sheet header goes to a dedicated
// SalesRow column. Headers are normalized (lowercase, alphanumeric only) so
// "Mobile No.", "Expiry Date " etc. match despite punctuation/spacing.
// ---------------------------------------------------------------------------

type FieldKind = 'string' | 'decimal' | 'date';

interface FieldDef {
  field: string; // SalesRow column name
  kind: FieldKind;
  headers: string[]; // normalized header synonyms
}

const FIELD_DEFS: FieldDef[] = [
  { field: 'userName', kind: 'string', headers: ['username'] },
  { field: 'customerName', kind: 'string', headers: ['name', 'customername'] },
  { field: 'pinCode', kind: 'string', headers: ['pincode'] },
  { field: 'salesPerson', kind: 'string', headers: ['salesperson'] },
  { field: 'address', kind: 'string', headers: ['address'] },
  { field: 'mobileNo', kind: 'string', headers: ['mobileno', 'mobile', 'mobilenumber'] },
  { field: 'expiryDate', kind: 'date', headers: ['expirydate'] },
  { field: 'modeOfRenew', kind: 'string', headers: ['modeofrenew'] },
  { field: 'billNo', kind: 'string', headers: ['billno', 'billnumber'] },
  { field: 'billDate', kind: 'date', headers: ['billdate'] },
  { field: 'clientGst', kind: 'string', headers: ['clientgst', 'clientgstno'] },
  { field: 'companyGstNo', kind: 'string', headers: ['companygstno', 'companygst'] },
  { field: 'sgst', kind: 'decimal', headers: ['sgst'] },
  { field: 'cgst', kind: 'decimal', headers: ['cgst'] },
  { field: 'billAmount', kind: 'decimal', headers: ['billamount'] },
  { field: 'adjustedAmount', kind: 'decimal', headers: ['adjustedamount'] },
  { field: 'actualBillAmount', kind: 'decimal', headers: ['actualbillamount'] },
  { field: 'discountAmount', kind: 'decimal', headers: ['discountamount'] },
  { field: 'userPendingAmount', kind: 'decimal', headers: ['userpendingamount'] },
  { field: 'site', kind: 'string', headers: ['site'] },
  { field: 'buildingName', kind: 'string', headers: ['buildingname', 'building'] },
  { field: 'operatorName', kind: 'string', headers: ['operatorname', 'operator'] },
  { field: 'franchiseeName', kind: 'string', headers: ['franchiseename', 'franchisee'] },
  { field: 'userCurrentStatus', kind: 'string', headers: ['usercurrentstatus', 'status'] },
  { field: 'onlineTransactionNo', kind: 'string', headers: ['onlinetransactionno', 'transactionno'] },
  { field: 'inquiryRemarks', kind: 'string', headers: ['inquiryremarks'] },
  { field: 'remarks', kind: 'string', headers: ['remarks'] },
  { field: 'planName', kind: 'string', headers: ['planname'] },
];

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

type ParsedRow = {
  salesType: ZoneType;
  zoneName: string;
  planAmount: number;
  activationType: string | null;
  extra: Record<string, string | number | null> | null;
  [field: string]: unknown;
};

// Parse the uploaded sheet into fully structured rows. The New/Renewal type is
// the upload's `salesType` (from which slot the file was dropped in) — every row
// takes it. Zone + plan amount are required (they drive the commission engine);
// every other recognized header fills its dedicated column; the rest land in
// `extra`. An "Activation Type" column, if present, is captured but not used.
function parseSalesSheet(file: Express.Multer.File, salesType: ZoneType) {
  const { columns, rows } = parseFirstSheet(file.buffer);
  if (rows.length === 0) throw ApiError.badRequest(`"${file.originalname}" has no data rows`);

  const zoneKey = findColumnKey(columns, ZONE_NAME_COLS);
  const amountKey = findColumnKey(columns, PLAN_AMOUNT_COLS);
  if (!zoneKey || !amountKey) {
    throw ApiError.badRequest(
      `Could not find the required columns in "${file.originalname}". Need a zone-name column (e.g. "Zone Name") and a plan-amount column (e.g. "Plan Amount"). Found: ${columns.join(', ')}`,
    );
  }
  // "Activation Type" is optional now — captured for reference, not for the type.
  const typeKey = findColumnKey(columns, ACTIVATION_TYPE_COLS);

  // Resolve each sheet header once: dedicated field, required field, or extra.
  const headerToField = new Map<string, FieldDef>();
  for (const def of FIELD_DEFS) for (const h of def.headers) headerToField.set(h, def);
  const reserved = new Set([zoneKey, amountKey, ...(typeKey ? [typeKey] : [])]);
  const mappedCols: { key: string; def: FieldDef }[] = [];
  const extraCols: string[] = [];
  for (const col of columns) {
    if (reserved.has(col)) continue;
    const def = headerToField.get(normalizeHeader(col));
    if (def && !mappedCols.some((m) => m.def.field === def.field)) mappedCols.push({ key: col, def });
    else extraCols.push(col);
  }

  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    const zoneName = String(row[zoneKey] ?? '').trim();
    if (zoneName === '') continue; // zone drives commission matching; skip blanks

    const rawType = typeKey && row[typeKey] != null ? String(row[typeKey]).trim() : null;
    const record: ParsedRow = {
      salesType, // from the upload's New/Renewal slot, not the sheet
      zoneName,
      planAmount: parseAmount(row[amountKey]),
      activationType: rawType || null,
      extra: null,
    };

    for (const { key, def } of mappedCols) {
      const val = row[key];
      if (def.kind === 'decimal') record[def.field] = parseAmountOrNull(val);
      else if (def.kind === 'date') record[def.field] = parseSheetDate(val);
      else {
        const s = val == null ? '' : String(val).trim();
        record[def.field] = s === '' ? null : s;
      }
    }

    if (extraCols.length > 0) {
      const extra: Record<string, string | number | null> = {};
      let has = false;
      for (const col of extraCols) {
        const val = row[col];
        if (val != null && String(val).trim() !== '') {
          extra[col] = val;
          has = true;
        }
      }
      if (has) record.extra = extra;
    }

    parsed.push(record);
  }

  return { columns, rows: parsed };
}

const INSERT_BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Tab 1 — Upload Sales Sheet (store + lock; NO calculation)
// ---------------------------------------------------------------------------

export interface UploadResult {
  uploadId: string;
  month: string;
  salesType: ZoneType;
  fileName: string;
  rowCount: number;
  version: number;
  replaced: boolean;
  unmatchedZoneNames: string[]; // sales zones not in the master (won't match any vendor)
}

const typeLabel = (t: ZoneType) => (t === 'NEW' ? 'New' : 'Renewal');

// Persist the original file to object storage so it can be downloaded later.
// Returns the storage key (saved in SalesUpload.filePath).
async function persistOriginal(month: string, file: Express.Multer.File): Promise<string> {
  const key = `sales/${month}/${Date.now()}__${safeFilePart(file.originalname)}`;
  await storage.put(key, file.buffer, contentTypeFor(file.originalname));
  return key;
}

export async function uploadSalesSheet(
  month: string,
  salesType: ZoneType,
  file: Express.Multer.File,
  actorId: string,
  isAdmin: boolean,
  replace: boolean,
): Promise<UploadResult> {
  const { columns, rows } = parseSalesSheet(file, salesType);
  if (rows.length === 0) {
    throw ApiError.badRequest(`"${file.originalname}" has no rows with a zone name`);
  }

  const label = `${typeLabel(salesType)} sales sheet for ${month}`;
  // Duplicate rules per (month, type): a standard user can only upload when none
  // exists; replacing is admin-only, requires explicit confirmation, versions++.
  const existing = await prisma.salesUpload.findUnique({
    where: { month_salesType: { month, salesType } },
  });
  let version = 1;
  if (existing) {
    if (!isAdmin) {
      throw ApiError.forbidden(`${label} already exists. Only an admin can replace it.`);
    }
    if (!replace) {
      throw ApiError.conflict(`${label} already exists. Confirm replacement to overwrite it.`, {
        existingUploadId: existing.id,
        month,
        salesType,
      });
    }
    version = existing.version + 1;
    // Remove the previous file + rows (rows cascade on delete).
    if (existing.filePath) await storage.delete(existing.filePath);
    await prisma.salesUpload.delete({ where: { id: existing.id } });
  }

  const filePath = await persistOriginal(month, file);
  const upload = await prisma.salesUpload.create({
    data: {
      month,
      salesType,
      fileName: file.originalname,
      filePath,
      rowCount: rows.length,
      columns: columns as unknown as Prisma.InputJsonValue,
      locked: true,
      status: 'UPLOADED',
      version,
      uploadedById: actorId,
    },
  });

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE).map((r) => {
      const { extra, ...fields } = r;
      return {
        ...fields,
        uploadId: upload.id,
        extra: extra === null ? Prisma.JsonNull : (extra as unknown as Prisma.InputJsonValue),
      };
    });
    await prisma.salesRow.createMany({ data: batch as Prisma.SalesRowCreateManyInput[] });
  }

  const unmatchedZoneNames = await computeUnmatchedZones(rows);

  await writeAudit({
    userId: actorId,
    action: existing ? 'SALES_REPLACED' : 'SALES_UPLOADED',
    entityType: 'SalesUpload',
    entityId: upload.id,
    metadata: { month, salesType, fileName: file.originalname, rows: rows.length, version },
  });

  return {
    uploadId: upload.id,
    month,
    salesType,
    fileName: file.originalname,
    rowCount: rows.length,
    version,
    replaced: !!existing,
    unmatchedZoneNames,
  };
}

async function computeUnmatchedZones(rows: { zoneName: string }[]): Promise<string[]> {
  const seen = new Set(rows.map((r) => r.zoneName));
  const masterZones = await prisma.zone.findMany({ select: { name: true } });
  const masterByName = new Set(masterZones.map((z) => z.name.toLowerCase()));
  return [...seen].filter((n) => !masterByName.has(n.toLowerCase()));
}

// Upload history grid (Tab 1) — one row per month.
export async function listSalesUploads() {
  const uploads = await prisma.salesUpload.findMany({
    orderBy: { month: 'desc' },
    include: { uploadedBy: { select: { name: true } } },
  });
  return uploads.map((u) => ({
    id: u.id,
    month: u.month,
    salesType: u.salesType,
    fileName: u.fileName,
    rowCount: u.rowCount,
    locked: u.locked,
    status: u.status,
    version: u.version,
    uploadedBy: u.uploadedBy?.name ?? null,
    uploadedAt: u.createdAt.toISOString(),
    hasFile: !!u.filePath,
  }));
}

export async function setSalesUploadLock(id: string, locked: boolean, actorId: string) {
  const upload = await prisma.salesUpload.findUnique({ where: { id } });
  if (!upload) throw ApiError.notFound('Sales upload not found');
  const updated = await prisma.salesUpload.update({ where: { id }, data: { locked } });
  await writeAudit({
    userId: actorId,
    action: locked ? 'SALES_LOCKED' : 'SALES_UNLOCKED',
    entityType: 'SalesUpload',
    entityId: id,
    metadata: { month: upload.month },
  });
  return { id: updated.id, locked: updated.locked };
}

export async function deleteSalesUpload(id: string, actorId: string) {
  const upload = await prisma.salesUpload.findUnique({ where: { id } });
  if (!upload) throw ApiError.notFound('Sales upload not found');
  if (upload.filePath) await storage.delete(upload.filePath);
  await prisma.salesUpload.delete({ where: { id } }); // rows cascade
  await writeAudit({
    userId: actorId,
    action: 'SALES_DELETED',
    entityType: 'SalesUpload',
    entityId: id,
    metadata: { month: upload.month },
  });
}

// Returns a readable stream of the original file (from object storage).
export async function getSalesUploadFile(id: string) {
  const upload = await prisma.salesUpload.findUnique({ where: { id } });
  if (!upload || !upload.filePath) throw ApiError.notFound('Original file not available');
  const { stream, contentLength } = await storage.getStream(upload.filePath);
  return { stream, contentLength, fileName: upload.fileName };
}

// ---------------------------------------------------------------------------
// Tab 2 — Calculations from a stored sheet (per-vendor + bulk)
// ---------------------------------------------------------------------------

// Load a month's stored rows (across its New + Renewal uploads) and aggregate
// plan amount by (type, zoneNameLower). Throws if nothing is uploaded yet.
async function aggregateStoredMonth(month: string) {
  const uploadCount = await prisma.salesUpload.count({ where: { month } });
  if (uploadCount === 0) {
    throw ApiError.badRequest(`No sales sheet uploaded for ${month}. Please upload it first.`);
  }
  const rows = await prisma.salesRow.findMany({
    where: { upload: { month } },
    select: { salesType: true, zoneName: true, planAmount: true },
  });
  const agg: Record<ZoneType, Map<string, number>> = { NEW: new Map(), RENEWAL: new Map() };
  for (const r of rows) {
    const key = r.zoneName.toLowerCase();
    agg[r.salesType].set(key, (agg[r.salesType].get(key) ?? 0) + Number(r.planAmount));
  }
  return { agg };
}

type VendorWithZones = Prisma.VendorGetPayload<{
  include: { zoneAssignments: { include: { zone: true } } };
}>;

// Build one vendor's zone-sales inputs from the month aggregate.
function vendorZoneInputs(
  vendor: VendorWithZones,
  agg: Record<ZoneType, Map<string, number>>,
): ZoneSalesInput[] {
  const zones: ZoneSalesInput[] = [];
  for (const a of vendor.zoneAssignments) {
    const total = agg[a.zoneType].get(a.zone.name.toLowerCase());
    if (total && total > 0) {
      zones.push({
        zoneId: a.zoneId,
        zoneName: a.zone.name,
        zoneType: a.zoneType,
        commissionPercentage: Number(a.commissionPercentage),
        zoneSales: total,
      });
    }
  }
  return zones;
}

// Create a DRAFT calculation for one vendor from prepared zone inputs.
// Returns null when there is nothing to calculate (no matching sales and no
// fixed pay). Assumes the caller already checked for a vendor+month duplicate.
async function createVendorCalc(
  vendor: VendorWithZones,
  zones: ZoneSalesInput[],
  month: string,
  defaultGst: number,
  actorId: string,
) {
  if (zones.length === 0 && !vendor.fixedPayEnabled) return null;

  const gstPercentage = vendor.gstNumber ? defaultGst : 0;
  const result = computeCommissionFromZoneSales({
    agrApplicable: vendor.agrApplicable,
    agrPercentage: Number(vendor.agrPercentage),
    gstPercentage,
    tdsPercentage: Number(vendor.tdsPercentage),
    fixedPayAmount: vendor.fixedPayEnabled ? Number(vendor.fixedPayAmount ?? 0) : 0,
    zones,
  });

  const calc = await prisma.commissionCalculation.create({
    data: {
      vendorId: vendor.id,
      month,
      billingPeriod: null,
      totalSales: result.totalSales,
      agrApplicable: vendor.agrApplicable,
      agrPercentage: Number(vendor.agrPercentage),
      gstPercentage,
      tdsPercentage: Number(vendor.tdsPercentage),
      agrAmount: result.agrAmount,
      salesAfterAgr: result.salesAfterAgr,
      grossCommission: result.grossCommission,
      gstAmount: result.gstAmount,
      tdsAmount: result.tdsAmount,
      fixedPayAmount: result.fixedPayAmount,
      finalPayable: result.finalPayable,
      status: 'DRAFT',
      createdById: actorId,
      breakdowns: {
        create: result.breakdowns.map((b) => ({
          zoneId: b.zoneId,
          zoneName: b.zoneName,
          zoneType: b.zoneType,
          commissionPercentage: b.commissionPercentage,
          baseAmount: b.baseAmount,
          commissionAmount: b.commissionAmount,
        })),
      },
    },
  });

  await writeAudit({
    userId: actorId,
    action: 'CALCULATION_CREATED',
    entityType: 'CommissionCalculation',
    entityId: calc.id,
    metadata: { vendorId: vendor.id, month, source: 'SALES_SHEET', finalPayable: result.finalPayable },
  });

  return { calc, result };
}

// Active vendors for the calculation dropdown; flags those already calculated
// for the given month so the UI can mark them.
export async function getVendorsForMonth(month: string) {
  const [vendors, existing] = await Promise.all([
    prisma.vendor.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { vendorName: 'asc' },
      select: { id: true, vendorName: true, companyName: true },
    }),
    prisma.commissionCalculation.findMany({ where: { month }, select: { vendorId: true } }),
  ]);
  const done = new Set(existing.map((e) => e.vendorId));
  return vendors.map((v) => ({ ...v, alreadyCalculated: done.has(v.id) }));
}

// Per-vendor calculation (the primary Tab-2 flow).
export async function generateVendorForMonth(month: string, vendorId: string, actorId: string) {
  const { agg } = await aggregateStoredMonth(month);

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { zoneAssignments: { include: { zone: true } } },
  });
  if (!vendor) throw ApiError.notFound('Vendor not found');
  if (vendor.status !== 'ACTIVE') throw ApiError.badRequest('Vendor is not active');

  const existing = await prisma.commissionCalculation.findFirst({
    where: { vendorId, month },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.badRequest(
      `${vendor.vendorName} already has a calculation for ${month}. Delete it first to recalculate.`,
    );
  }

  const zones = vendorZoneInputs(vendor, agg);
  const defaultGst = await getNumberSetting(DEFAULT_GST_KEY, 18);
  const created = await createVendorCalc(vendor, zones, month, defaultGst, actorId);
  if (!created) {
    throw ApiError.badRequest(
      `${vendor.vendorName} has no sales in its assigned zones for ${month} and no fixed pay — nothing to calculate.`,
    );
  }

  return {
    vendorId: vendor.id,
    vendorName: vendor.vendorName,
    calculationId: created.calc.id,
    month,
    totalSales: created.result.totalSales,
    grossCommission: created.result.grossCommission,
    finalPayable: created.result.finalPayable,
    matchedZones: zones.length,
  };
}

export interface BulkGenerateResult {
  month: string;
  created: { vendorId: string; vendorName: string; calculationId: string; finalPayable: number }[];
  skippedExisting: string[];
  vendorsWithoutMatchingZones: number;
  unmatchedZoneNames: string[];
}

// Shared engine for bulk/selected generation: process a set of ACTIVE vendors
// against the stored month, skipping any that already have a calculation.
// `vendorIds === 'all'` processes every active vendor.
async function runBulkGeneration(
  month: string,
  vendorIds: string[] | 'all',
  actorId: string,
): Promise<BulkGenerateResult> {
  const { agg } = await aggregateStoredMonth(month);

  const rows = await prisma.salesRow.findMany({
    where: { upload: { month } },
    select: { zoneName: true },
  });
  const unmatchedZoneNames = await computeUnmatchedZones(rows);

  const vendors = await prisma.vendor.findMany({
    where: {
      status: 'ACTIVE',
      ...(vendorIds === 'all' ? {} : { id: { in: vendorIds } }),
    },
    include: { zoneAssignments: { include: { zone: true } } },
  });
  const defaultGst = await getNumberSetting(DEFAULT_GST_KEY, 18);
  const alreadyDone = await prisma.commissionCalculation.findMany({
    where: { month },
    select: { vendorId: true },
  });
  const done = new Set(alreadyDone.map((e) => e.vendorId));

  const created: BulkGenerateResult['created'] = [];
  const skippedExisting: string[] = [];
  let vendorsWithoutMatchingZones = 0;

  for (const vendor of vendors) {
    if (done.has(vendor.id)) {
      skippedExisting.push(vendor.vendorName);
      continue;
    }
    const zones = vendorZoneInputs(vendor, agg);
    const result = await createVendorCalc(vendor, zones, month, defaultGst, actorId);
    if (!result) {
      vendorsWithoutMatchingZones++;
      continue;
    }
    created.push({
      vendorId: vendor.id,
      vendorName: vendor.vendorName,
      calculationId: result.calc.id,
      finalPayable: result.result.finalPayable,
    });
  }

  return { month, created, skippedExisting, vendorsWithoutMatchingZones, unmatchedZoneNames };
}

// Bulk: calculate every active vendor that matches, reusing the stored sheet.
export function generateAllForMonth(month: string, actorId: string): Promise<BulkGenerateResult> {
  return runBulkGeneration(month, 'all', actorId);
}

// Calculate a specific set of selected vendors (multi-select flow).
export function generateSelectedVendors(
  month: string,
  vendorIds: string[],
  actorId: string,
): Promise<BulkGenerateResult> {
  return runBulkGeneration(month, vendorIds, actorId);
}

// ---------------------------------------------------------------------------
// Sales Summary queries
// ---------------------------------------------------------------------------

export async function listSalesMonths() {
  const groups = await prisma.salesUpload.groupBy({
    by: ['month'],
    _sum: { rowCount: true },
    orderBy: { month: 'desc' },
  });
  return groups.map((g) => ({ month: g.month, rowCount: g._sum.rowCount ?? 0 }));
}

// Whitelist of sortable columns (never pass user input straight to orderBy).
const SORTABLE_COLUMNS = new Set([
  'billDate',
  'billAmount',
  'actualBillAmount',
  'planAmount',
  'customerName',
  'userName',
  'zoneName',
]);

const SEARCH_FIELDS = ['userName', 'customerName', 'mobileNo', 'billNo', 'zoneName', 'planName'] as const;

export interface SalesListQuery {
  month: string;
  search?: string;
  salesType?: ZoneType;
  zone?: string;
  operator?: string;
  site?: string;
  status?: string;
  modeOfRenew?: string;
  dateFrom?: string; // YYYY-MM-DD, on billDate
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export async function listSales(query: SalesListQuery) {
  const where: Prisma.SalesRowWhereInput = {
    upload: { month: query.month },
  };
  if (query.salesType) where.salesType = query.salesType;
  if (query.zone) where.zoneName = query.zone;
  if (query.operator) where.operatorName = query.operator;
  if (query.site) where.site = query.site;
  if (query.status) where.userCurrentStatus = query.status;
  if (query.modeOfRenew) where.modeOfRenew = query.modeOfRenew;
  if (query.dateFrom || query.dateTo) {
    where.billDate = {};
    if (query.dateFrom) where.billDate.gte = new Date(`${query.dateFrom}T00:00:00Z`);
    if (query.dateTo) where.billDate.lte = new Date(`${query.dateTo}T23:59:59Z`);
  }
  if (query.search) {
    where.OR = SEARCH_FIELDS.map((f) => ({
      [f]: { contains: query.search, mode: 'insensitive' },
    }));
  }

  const sortBy = query.sortBy && SORTABLE_COLUMNS.has(query.sortBy) ? query.sortBy : 'billDate';
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

  const [total, items, sum] = await prisma.$transaction([
    prisma.salesRow.count({ where }),
    prisma.salesRow.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    // Grand total of plan amount across ALL matching rows (not just this page).
    prisma.salesRow.aggregate({ where, _sum: { planAmount: true } }),
  ]);

  return {
    items,
    total,
    totalPlanAmount: Number(sum._sum.planAmount ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export interface SalesGroupedQuery {
  month: string;
  search?: string;
  salesType?: 'NEW' | 'RENEWAL';
  zone?: string;
}

// Zone+type aggregation for the Sales Summary grouped view. Same filter
// semantics as listSales, so group totals reflect only matching rows. All
// groups for the month come back in one response (zone count is bounded);
// the per-row drill-down goes through listSales with a zone filter.
export async function listSalesGrouped(query: SalesGroupedQuery) {
  const where: Prisma.SalesRowWhereInput = {
    upload: { month: query.month },
  };
  if (query.salesType) where.salesType = query.salesType;
  if (query.zone) where.zoneName = query.zone;
  if (query.search) {
    where.OR = SEARCH_FIELDS.map((f) => ({
      [f]: { contains: query.search, mode: 'insensitive' },
    }));
  }

  // Promise.all (not $transaction) — groupBy loses its result typing inside a
  // transaction array, and strict read consistency isn't needed here.
  const [groups, sum] = await Promise.all([
    prisma.salesRow.groupBy({
      by: ['zoneName', 'salesType'],
      where,
      _count: { _all: true },
      _sum: { planAmount: true },
      orderBy: [{ zoneName: 'asc' }, { salesType: 'asc' }],
    }),
    prisma.salesRow.aggregate({ where, _sum: { planAmount: true } }),
  ]);

  return {
    groups: groups.map((g) => ({
      zoneName: g.zoneName,
      salesType: g.salesType,
      count: g._count._all,
      totalPlanAmount: Number(g._sum.planAmount ?? 0),
    })),
    totalPlanAmount: Number(sum._sum.planAmount ?? 0),
  };
}

export async function getSalesFilterOptions(month: string) {
  const distinct = async (field: 'zoneName' | 'operatorName' | 'site' | 'userCurrentStatus' | 'modeOfRenew') => {
    const rows = await prisma.salesRow.findMany({
      // zoneName is non-nullable, so `not: null` is rejected for it — only
      // filter out nulls on the optional columns.
      where: { upload: { month }, ...(field === 'zoneName' ? {} : { [field]: { not: null } }) },
      distinct: [field],
      select: { [field]: true } as Prisma.SalesRowSelect,
      orderBy: { [field]: 'asc' },
    });
    return rows
      .map((r) => (r as unknown as Record<string, string | null>)[field])
      .filter((v): v is string => !!v);
  };

  const [zones, operators, sites, statuses, renewModes] = await Promise.all([
    distinct('zoneName'),
    distinct('operatorName'),
    distinct('site'),
    distinct('userCurrentStatus'),
    distinct('modeOfRenew'),
  ]);
  return { zones, operators, sites, statuses, renewModes };
}

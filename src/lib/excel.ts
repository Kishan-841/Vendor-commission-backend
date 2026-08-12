import * as XLSX from 'xlsx';

export interface ParsedSheet {
  columns: string[];
  rows: Record<string, string | number | null>[];
}

// Parse the first worksheet of an uploaded Excel/CSV buffer into an array of
// row objects keyed by the header row. Values are kept as strings/numbers so
// they round-trip cleanly into the zoneData JSON column.
export function parseFirstSheet(buffer: Buffer): ParsedSheet {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { columns: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];

  // header: 1 => array-of-arrays so we can read the real header row and
  // preserve original column names (spaces, casing) exactly as uploaded.
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  });

  if (aoa.length === 0) return { columns: [], rows: [] };

  const headerRow = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
  const columns = headerRow.filter((h) => h.length > 0);

  const rows: Record<string, string | number | null>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    const obj: Record<string, string | number | null> = {};
    let hasValue = false;
    headerRow.forEach((col, idx) => {
      if (!col) return;
      const val = raw[idx] ?? null;
      obj[col] = val === '' ? null : (val as string | number | null);
      if (val !== null && val !== '') hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }

  return { columns, rows };
}

// Find the header KEY that matches any of `candidates` (case-insensitive,
// trimmed). Used to auto-detect the zone-name / plan-amount columns.
export function findColumnKey(columns: string[], candidates: string[]): string | undefined {
  const lower = new Map(columns.map((c) => [c.toLowerCase().trim(), c]));
  for (const cand of candidates) {
    const hit = lower.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

// Parse a currency/number cell that may contain commas, ₹, or spaces.
export function parseAmount(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const n = Number(String(value).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Like parseAmount, but empty/invalid cells become null (for optional Decimal
// columns where 0 and "not provided" mean different things).
export function parseAmountOrNull(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Excel serial-date epoch (1899-12-30) in ms, for numeric date cells.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

// Parse a date cell that may be a DD-MM-YYYY[ HH:mm:ss] string (the format the
// billing export uses — native `new Date()` would swap day/month) or an Excel
// serial number. Returns null for anything unparseable.
export function parseSheetDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null; // not a plausible serial date
    return new Date(EXCEL_EPOCH_MS + value * 86400000);
  }
  const m = String(value)
    .trim()
    .match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const date = new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

// Find the value of the column whose header matches any of `candidates`
// (case-insensitive), e.g. to derive a zone name from a "Zone"/"Area" column.
export function pickColumn(
  row: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const lowerMap = new Map<string, string>();
  for (const key of Object.keys(row)) lowerMap.set(key.toLowerCase().trim(), key);
  for (const cand of candidates) {
    const key = lowerMap.get(cand.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return undefined;
}

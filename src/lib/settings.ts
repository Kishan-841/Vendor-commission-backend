import { prisma } from './prisma.js';

// Read a numeric setting, falling back to a default when it isn't set.
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  const val = typeof row.value === 'number' ? row.value : Number(row.value);
  return Number.isFinite(val) ? val : fallback;
}

export const DEFAULT_GST_KEY = 'DEFAULT_GST_PERCENTAGE';

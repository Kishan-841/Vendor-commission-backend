import 'dotenv/config';
import { z } from 'zod';

// Validate environment at boot so misconfiguration fails fast and loudly
// rather than surfacing as a confusing runtime error deep in a request.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
    JWT_EXPIRES_IN: z.string().default('1d'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    MAX_UPLOAD_MB: z.coerce.number().default(10),

    // ── File storage ─────────────────────────────────────────────────────────
    // `local` writes under STORAGE_LOCAL_DIR (dev). `r2` uses Cloudflare R2.
    STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('storage'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === 'r2') {
      const need: [keyof typeof v, string | undefined][] = [
        ['R2_ACCESS_KEY_ID', v.R2_ACCESS_KEY_ID],
        ['R2_SECRET_ACCESS_KEY', v.R2_SECRET_ACCESS_KEY],
        ['R2_BUCKET', v.R2_BUCKET],
      ];
      for (const [key, val] of need) {
        if (!val) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when STORAGE_DRIVER=r2` });
      }
      if (!v.R2_ENDPOINT && !v.R2_ACCOUNT_ID) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['R2_ENDPOINT'], message: 'Set R2_ENDPOINT or R2_ACCOUNT_ID when STORAGE_DRIVER=r2' });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

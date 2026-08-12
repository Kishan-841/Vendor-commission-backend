import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// One object-storage interface, two drivers. Keys are namespaced paths like
// "receipts/<uuid>__scan.pdf" or "bills/GZN-202606-0001.pdf". The DB stores the
// key; downloads proxy-stream it back through the API (auth stays enforced).
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<{ stream: Readable; contentLength?: number }>;
  delete(key: string): Promise<void>;
}

// ── Local driver: files under STORAGE_LOCAL_DIR, keys map to relative paths ──
function createLocalStorage(): Storage {
  const root = path.resolve(env.STORAGE_LOCAL_DIR);
  const resolve = (key: string) => {
    // Guard against path traversal in a key.
    const abs = path.resolve(root, key);
    if (!abs.startsWith(root + path.sep)) throw ApiError.badRequest('Invalid storage key');
    return abs;
  };
  return {
    async put(key, body) {
      const abs = resolve(key);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    },
    async getStream(key) {
      const abs = resolve(key);
      if (!fs.existsSync(abs)) throw ApiError.notFound('File not found');
      const contentLength = fs.statSync(abs).size;
      return { stream: fs.createReadStream(abs), contentLength };
    },
    async delete(key) {
      try {
        fs.unlinkSync(resolve(key));
      } catch {
        /* already gone — best effort */
      }
    },
  };
}

// ── R2 driver: Cloudflare R2 via the S3-compatible API ──────────────────────
function createR2Storage(): Storage {
  const endpoint = env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bucket = env.R2_BUCKET!;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async getStream(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) throw ApiError.notFound('File not found');
        return { stream: res.Body as Readable, contentLength: res.ContentLength };
      } catch (err) {
        if (err instanceof NoSuchKey) throw ApiError.notFound('File not found');
        throw err;
      }
    },
    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        /* best effort */
      }
    },
  };
}

export const storage: Storage =
  env.STORAGE_DRIVER === 'r2' ? createR2Storage() : createLocalStorage();

// Small helpers used to build keys + safe filenames.
export const safeFilePart = (s: string) => s.replace(/[^\w.\- ]/g, '_');

export function contentTypeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
  };
  return map[ext] ?? 'application/octet-stream';
}

import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Excel uploads are parsed in-process and discarded, so keep them in memory
// rather than writing to disk. Cap size to avoid unbounded memory use.
const ALLOWED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'application/octet-stream', // some browsers send this for .xlsx
]);

export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okExt = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (ALLOWED.has(file.mimetype) || okExt) return cb(null, true);
    cb(ApiError.badRequest('Only .xlsx, .xls or .csv files are allowed'));
  },
});

// Receipt attachments: images or PDF, kept in memory then written to UPLOAD_DIR.
// The extension MUST be in the allowlist — we do not trust the client-supplied
// MIME type (e.g. application/octet-stream), which would let an .html/.svg
// through and enable stored XSS when the file is later served.
export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(pdf|png|jpe?g|webp)$/i.test(file.originalname)) return cb(null, true);
    cb(ApiError.badRequest('Attachment must be a PDF or image (png, jpg, jpeg, webp)'));
  },
});

import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { excelUpload } from '../../lib/upload.js';
import {
  uploadBodySchema,
  idParamSchema,
  generateVendorBodySchema,
  generateVendorsBodySchema,
  generateAllBodySchema,
  monthQuerySchema,
  exportQuerySchema,
  salesListQuerySchema,
  salesFiltersQuerySchema,
} from './sales.schema.js';
import {
  uploadHandler,
  listUploadsHandler,
  unlockHandler,
  lockHandler,
  deleteUploadHandler,
  downloadUploadHandler,
  vendorsForMonthHandler,
  generateVendorHandler,
  generateVendorsHandler,
  generateAllHandler,
  listMonthsHandler,
  listSalesHandler,
  filterOptionsHandler,
  exportWorkbookHandler,
} from './sales.controller.js';

// Mounted under /api/calculations. Tab-2 generation from a STORED monthly sheet
// (no file upload here — the sheet is uploaded separately under /sales/uploads).
export const salesRouter = Router();

salesRouter.use(authenticate);

// Active vendors for the calculation dropdown (flags already-calculated ones).
salesRouter.get('/vendors-for-month', validate({ query: monthQuerySchema }), vendorsForMonthHandler);
// Per-vendor calculation (primary flow) — both roles.
salesRouter.post('/generate-vendor', validate({ body: generateVendorBodySchema }), generateVendorHandler);
// Multiple selected vendors at once — both roles.
salesRouter.post('/generate-vendors', validate({ body: generateVendorsBodySchema }), generateVendorsHandler);
// Bulk: calculate all matching vendors from the stored sheet — admin only.
salesRouter.post(
  '/generate-all',
  requireRole('ADMIN'),
  validate({ body: generateAllBodySchema }),
  generateAllHandler,
);

// Mounted under /api/sales. Tab-1 upload management + the Sales Summary reads.
export const salesSummaryRouter = Router();

salesSummaryRouter.use(authenticate);

// Upload a monthly sheet (both roles; standard users only when none exists,
// enforced in the service). Replacing an existing month is admin-only.
salesSummaryRouter.post(
  '/uploads',
  excelUpload.fields([{ name: 'file', maxCount: 1 }]),
  validate({ body: uploadBodySchema }),
  uploadHandler,
);
salesSummaryRouter.get('/uploads', listUploadsHandler);
salesSummaryRouter.get('/uploads/:id/file', validate({ params: idParamSchema }), downloadUploadHandler);
// Lock/unlock/delete — admin only.
salesSummaryRouter.post(
  '/uploads/:id/unlock',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  unlockHandler,
);
salesSummaryRouter.post(
  '/uploads/:id/lock',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  lockHandler,
);
salesSummaryRouter.delete(
  '/uploads/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  deleteUploadHandler,
);

// Sales Summary reads.
salesSummaryRouter.get('/months', listMonthsHandler);
salesSummaryRouter.get('/filters', validate({ query: salesFiltersQuerySchema }), filterOptionsHandler);
// Vendor + month Excel export (two-sheet workbook).
salesSummaryRouter.get('/export', validate({ query: exportQuerySchema }), exportWorkbookHandler);
salesSummaryRouter.get('/', validate({ query: salesListQuerySchema }), listSalesHandler);

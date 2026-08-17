import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { receiptUpload } from '../../lib/upload.js';
import {
  listVendorPayoutsQuerySchema,
  vendorIdParamSchema,
  idParamSchema,
  recordPaymentBodySchema,
} from './payout.schema.js';
import {
  listVendorPayoutsHandler,
  listPayoutMonthsHandler,
  vendorLedgerHandler,
  recordPaymentHandler,
  updatePaymentHandler,
  deletePaymentHandler,
  paymentAttachmentHandler,
  paymentReceiptHandler,
  vendorLedgerPdfHandler,
  exportPayoutsHandler,
} from './payout.controller.js';

// Mounted under /api/payouts. Both roles view and record receipts; deleting a
// receipt is ADMIN-only.
export const payoutRouter = Router();

payoutRouter.use(authenticate);

payoutRouter.get('/months', listPayoutMonthsHandler);
payoutRouter.get('/export', exportPayoutsHandler);
payoutRouter.get('/vendors', validate({ query: listVendorPayoutsQuerySchema }), listVendorPayoutsHandler);
payoutRouter.get('/vendors/:vendorId/ledger/pdf', validate({ params: vendorIdParamSchema }), vendorLedgerPdfHandler);
payoutRouter.get('/vendors/:vendorId/ledger', validate({ params: vendorIdParamSchema }), vendorLedgerHandler);

// Record a receipt (optional attachment). multer parses multipart before validate.
payoutRouter.post(
  '/calculations/:id/payments',
  receiptUpload.single('attachment'),
  validate({ params: idParamSchema, body: recordPaymentBodySchema }),
  recordPaymentHandler,
);
payoutRouter.patch(
  '/payments/:id',
  receiptUpload.single('attachment'),
  validate({ params: idParamSchema, body: recordPaymentBodySchema }),
  updatePaymentHandler,
);
payoutRouter.get('/payments/:id/attachment', validate({ params: idParamSchema }), paymentAttachmentHandler);
payoutRouter.get('/payments/:id/receipt', validate({ params: idParamSchema }), paymentReceiptHandler);
payoutRouter.delete(
  '/payments/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  deletePaymentHandler,
);

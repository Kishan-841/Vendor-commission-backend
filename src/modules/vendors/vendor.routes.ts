import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createVendorSchema,
  idParamSchema,
  listVendorsQuerySchema,
  updateVendorSchema,
} from './vendor.schema.js';
import {
  createVendorHandler,
  deleteVendorHandler,
  getVendorHandler,
  listVendorsHandler,
  updateVendorHandler,
} from './vendor.controller.js';

export const vendorRouter = Router();

// All vendor routes require authentication.
vendorRouter.use(authenticate);

// Read: both roles (Finance can view).
vendorRouter.get('/', validate({ query: listVendorsQuerySchema }), listVendorsHandler);
vendorRouter.get('/:id', validate({ params: idParamSchema }), getVendorHandler);

// Write: Admin only (per PRD, only Admin creates/edits/deletes vendors).
vendorRouter.post('/', requireRole('ADMIN'), validate({ body: createVendorSchema }), createVendorHandler);
vendorRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateVendorSchema }),
  updateVendorHandler,
);
vendorRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  deleteVendorHandler,
);

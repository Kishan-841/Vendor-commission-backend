import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { zoneCommissionQuerySchema, zoneCommissionExportQuerySchema } from './report.schema.js';
import { zoneCommissionHandler, zoneCommissionExportHandler } from './report.controller.js';

// Mounted under /api/reports. Read-only reports (both roles).
export const reportRouter = Router();

reportRouter.use(authenticate);

reportRouter.get(
  '/zone-commission',
  validate({ query: zoneCommissionQuerySchema }),
  zoneCommissionHandler,
);
reportRouter.get(
  '/zone-commission/export',
  validate({ query: zoneCommissionExportQuerySchema }),
  zoneCommissionExportHandler,
);

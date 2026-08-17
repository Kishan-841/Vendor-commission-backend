import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  bulkDeleteCalculationsSchema,
  createCalculationSchema,
  idParamSchema,
  listCalculationsQuerySchema,
  updateCalculationSchema,
} from './calculation.schema.js';
import {
  bulkDeleteCalculationsHandler,
  createCalculationHandler,
  deleteCalculationHandler,
  getCalculationHandler,
  listCalculationMonthsHandler,
  listCalculationsHandler,
  updateCalculationHandler,
} from './calculation.controller.js';

export const calculationRouter = Router();

calculationRouter.use(authenticate);

// Read: both roles (Finance views calculations).
calculationRouter.get('/', validate({ query: listCalculationsQuerySchema }), listCalculationsHandler);
// Literal path BEFORE '/:id' so "months" isn't captured as an id.
calculationRouter.get('/months', listCalculationMonthsHandler);
calculationRouter.get('/:id', validate({ params: idParamSchema }), getCalculationHandler);

// Create/edit/delete: Admin only.
calculationRouter.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createCalculationSchema }),
  createCalculationHandler,
);
calculationRouter.post(
  '/bulk-delete',
  requireRole('ADMIN'),
  validate({ body: bulkDeleteCalculationsSchema }),
  bulkDeleteCalculationsHandler,
);
calculationRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateCalculationSchema }),
  updateCalculationHandler,
);
calculationRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  deleteCalculationHandler,
);

import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { generateBillSchema, idParamSchema, listBillsQuerySchema } from './bill.schema.js';
import {
  downloadBillHandler,
  generateBillHandler,
  getBillHandler,
  listBillsHandler,
} from './bill.controller.js';

export const billRouter = Router();

billRouter.use(authenticate);

// Generate a bill — Admin or Finance (per PRD, both can generate bills).
billRouter.post(
  '/',
  requireRole('ADMIN', 'FINANCE'),
  validate({ body: generateBillSchema }),
  generateBillHandler,
);

// Read + download: both roles.
billRouter.get('/', validate({ query: listBillsQuerySchema }), listBillsHandler);
billRouter.get('/:id', validate({ params: idParamSchema }), getBillHandler);
billRouter.get('/:id/pdf', validate({ params: idParamSchema }), downloadBillHandler);

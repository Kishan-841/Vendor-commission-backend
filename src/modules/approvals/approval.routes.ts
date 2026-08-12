import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { idParamSchema, rejectSchema, remarksOptionalSchema } from './approval.schema.js';
import { approveHandler, historyHandler, rejectHandler, submitHandler } from './approval.controller.js';

// Mounted under /api/calculations. Workflow actions live on the calculation
// resource: /:id/submit, /:id/approve, /:id/reject, /:id/approvals.
export const approvalRouter = Router();

approvalRouter.use(authenticate);

// Submit for approval — Admin (who prepares the calculation).
approvalRouter.post(
  '/:id/submit',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: remarksOptionalSchema }),
  submitHandler,
);

// Approve / reject — Admin or Finance (per PRD, Finance/Admin approves).
approvalRouter.post(
  '/:id/approve',
  requireRole('ADMIN', 'FINANCE'),
  validate({ params: idParamSchema, body: remarksOptionalSchema }),
  approveHandler,
);
approvalRouter.post(
  '/:id/reject',
  requireRole('ADMIN', 'FINANCE'),
  validate({ params: idParamSchema, body: rejectSchema }),
  rejectHandler,
);

// Approval history / audit trail — both roles.
approvalRouter.get('/:id/approvals', validate({ params: idParamSchema }), historyHandler);

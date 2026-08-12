import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { listLogsQuerySchema } from './audit.schema.js';
import { listLogsHandler, logFiltersHandler } from './audit.controller.js';

export const auditRouter = Router();

// System logs expose every user's activity and IPs — ADMIN only.
auditRouter.use(authenticate, requireRole('ADMIN'));

auditRouter.get('/', validate({ query: listLogsQuerySchema }), listLogsHandler);
auditRouter.get('/filters', logFiltersHandler);

import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { excelUpload } from '../../lib/upload.js';
import {
  createZoneSchema,
  idParamSchema,
  listZonesQuerySchema,
  renameZoneSchema,
  uploadZonesBodySchema,
} from './zone.schema.js';
import {
  createZoneHandler,
  deleteZoneHandler,
  listUploadsHandler,
  listZonesHandler,
  renameZoneHandler,
  uploadZonesHandler,
} from './zone.controller.js';

export const zoneRouter = Router();

zoneRouter.use(authenticate);

// Excel upload — Admin only. multer parses the multipart body BEFORE validate,
// so the text fields (zoneType, replace) are present on req.body for the schema.
zoneRouter.post(
  '/upload',
  requireRole('ADMIN'),
  excelUpload.single('file'),
  validate({ body: uploadZonesBodySchema }),
  uploadZonesHandler,
);

// Create a single zone by name — Admin only.
zoneRouter.post('/', requireRole('ADMIN'), validate({ body: createZoneSchema }), createZoneHandler);

// Read: both roles.
zoneRouter.get('/', validate({ query: listZonesQuerySchema }), listZonesHandler);
zoneRouter.get('/uploads', listUploadsHandler);

// Mutate individual zones — Admin only.
zoneRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: renameZoneSchema }),
  renameZoneHandler,
);
zoneRouter.delete('/:id', requireRole('ADMIN'), validate({ params: idParamSchema }), deleteZoneHandler);

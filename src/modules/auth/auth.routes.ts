import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { loginSchema } from './auth.schema.js';
import { loginHandler, meHandler } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', validate({ body: loginSchema }), loginHandler);
authRouter.get('/me', authenticate, meHandler);

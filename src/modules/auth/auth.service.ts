import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { signToken } from '../../lib/jwt.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAudit } from '../../lib/audit.js';
import type { LoginInput } from './auth.schema.js';

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same generic message whether the email is unknown or the password is wrong,
  // so we don't leak which accounts exist.
  if (!user) throw ApiError.unauthorized('Invalid email or password');
  if (user.status !== 'ACTIVE') throw ApiError.forbidden('Account is inactive');

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  const token = signToken({ sub: user.id, role: user.role, email: user.email });

  await writeAudit({ userId: user.id, action: 'USER_LOGIN', entityType: 'User', entityId: user.id });

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
  });
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

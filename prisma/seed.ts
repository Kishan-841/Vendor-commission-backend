import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@email.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  const name = process.env.SEED_ADMIN_NAME ?? 'System Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  // Idempotent: re-running seed won't create duplicate admins.
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });

  // A default GST rate the calculation engine falls back to when a vendor has a
  // GST number but no explicit rate is provided. Stored as a setting so it can
  // change without a code deploy.
  await prisma.setting.upsert({
    where: { key: 'DEFAULT_GST_PERCENTAGE' },
    update: {},
    create: { key: 'DEFAULT_GST_PERCENTAGE', value: 18 },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Seeded admin: ${admin.email} (password: ${password})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

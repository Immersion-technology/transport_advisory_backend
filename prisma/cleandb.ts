/**
 * cleandb.ts — wipes all transactional data while keeping:
 *   - Admin user accounts (role = 'ADMIN')
 *   - vehicle_categories + document_pricing (pricing catalogue)
 *   - system_config (service_fee_rate etc.)
 *
 * Uses raw SQL so it works even before `prisma generate` has been run.
 *
 *   npx ts-node prisma/cleandb.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('⚠️  Cleaning database — keeping admin accounts, categories, pricing, and config…\n');

  // Delete in dependency order (children before parents).
  // TRUNCATE … CASCADE would be faster but requires superuser on Neon; plain
  // DELETE lets us keep specific rows (admin users) and avoids permission issues.
  const tables: Array<{ sql: string; label: string }> = [
    { sql: 'DELETE FROM application_status_history',  label: 'Status history' },
    { sql: 'DELETE FROM application_documents',       label: 'Application documents' },
    { sql: 'DELETE FROM deliveries',                  label: 'Deliveries' },
    { sql: 'DELETE FROM reminder_logs',               label: 'Reminder logs' },
    { sql: 'DELETE FROM reminder_preferences',        label: 'Reminder preferences' },
    { sql: 'DELETE FROM magic_link_tokens',           label: 'Magic link tokens' },
    { sql: 'DELETE FROM notification_logs',           label: 'Notification logs' },
    { sql: 'DELETE FROM applications',                label: 'Applications' },
    { sql: 'DELETE FROM vehicle_verifications',       label: 'Vehicle verifications' },
    { sql: 'DELETE FROM documents',                   label: 'Documents' },
    { sql: 'DELETE FROM vehicles',                    label: 'Vehicles' },
    { sql: "DELETE FROM users WHERE role = 'USER'",   label: 'Regular users' },
    { sql: 'DELETE FROM plate_registry',              label: 'Plate registry' },
  ];

  for (const { sql, label } of tables) {
    const result = await prisma.$executeRawUnsafe(sql);
    console.log(`  ${label.padEnd(28)} ${result} row(s) deleted`);
  }

  const admins = await prisma.$queryRawUnsafe<Array<{ email: string; role: string; is_super_admin: boolean }>>(
    'SELECT email, role, "isSuperAdmin" AS is_super_admin FROM users',
  );

  console.log('\n✅ Database clean. Remaining accounts:');
  admins.forEach((u) =>
    console.log(`   ${u.role}${u.is_super_admin ? ' (super)' : ''} — ${u.email}`),
  );
  console.log('\nRun `npm run db:seed` to refresh categories and pricing if needed.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Clean failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

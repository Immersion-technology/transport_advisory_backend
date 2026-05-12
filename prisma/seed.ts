import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID as uuid } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@transportadvisory.ng';
  const hashed = await bcrypt.hash('Admin@2026', 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      isSuperAdmin: true,
      permissions: ['MANAGE_APPLICATIONS', 'MANAGE_USERS', 'MANAGE_DELIVERIES', 'MANAGE_REMINDERS', 'MANAGE_ADMINS'],
    },
    create: {
      id: uuid(),
      email: adminEmail,
      phone: '08000000000',
      password: hashed,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'ADMIN',
      isSuperAdmin: true,
      permissions: ['MANAGE_APPLICATIONS', 'MANAGE_USERS', 'MANAGE_DELIVERIES', 'MANAGE_REMINDERS', 'MANAGE_ADMINS'],
      subscriptionTier: 'FLEET',
      emailVerified: true,
    },
  });
  console.log('✅ Super Admin ready:', admin.email, '(password: Admin@2026)');

  // ────────────────────────────────────────────────────────────
  // Vehicle category catalogue. Prices for Saloon / SUV / Pickup come from
  // the live pricing sheet; the rest are seeded with isActive=false so
  // admin can add their numbers from the pricing page before the public
  // checkout will accept them. CHANGE_OF_OWNERSHIP and HACKNEY_PERMIT prices
  // are admin-set per category.
  // ────────────────────────────────────────────────────────────
  type Seed = {
    key: string;
    label: string;
    sortOrder: number;
    pricing?: { type: 'MOTOR_INSURANCE' | 'VEHICLE_LICENSE' | 'ROADWORTHINESS' | 'HACKNEY_PERMIT' | 'CHANGE_OF_OWNERSHIP'; price: number; notes?: string }[];
  };
  const CATEGORY_SEEDS: Seed[] = [
    { key: 'saloon', label: 'Saloon Vehicles', sortOrder: 10, pricing: [
      { type: 'MOTOR_INSURANCE', price: 15000 },
      { type: 'ROADWORTHINESS',  price: 10500 },
      { type: 'VEHICLE_LICENSE', price: 3900  },
    ]},
    { key: 'suv', label: 'SUVs', sortOrder: 20, pricing: [
      { type: 'MOTOR_INSURANCE', price: 15000 },
      { type: 'ROADWORTHINESS',  price: 11000 },
      { type: 'VEHICLE_LICENSE', price: 4800  },
    ]},
    { key: 'pickup', label: 'Pickup Vehicles', sortOrder: 30, pricing: [
      { type: 'MOTOR_INSURANCE', price: 15000 },
      { type: 'ROADWORTHINESS',  price: 11000, notes: '6 months' },
      { type: 'VEHICLE_LICENSE', price: 4800  },
    ]},
    { key: 'bus_mini', label: 'Buses (mini)',          sortOrder: 40 },
    { key: 'bus_mid',  label: 'Buses (mid-size)',      sortOrder: 50 },
    { key: 'bus_max',  label: 'Buses (full / max)',    sortOrder: 60 },
    { key: 'truck_10', label: 'Trucks (10 tyres)',     sortOrder: 70 },
    { key: 'truck_14', label: 'Trucks (14 tyres)',     sortOrder: 80 },
    { key: 'truck_more', label: 'Trucks (more tyres)', sortOrder: 90 },
    { key: 'other',    label: 'Other vehicles',        sortOrder: 100 },
  ];

  for (const seed of CATEGORY_SEEDS) {
    const cat = await prisma.vehicleCategory.upsert({
      where: { key: seed.key },
      update: { label: seed.label, sortOrder: seed.sortOrder },
      create: { id: uuid(), key: seed.key, label: seed.label, sortOrder: seed.sortOrder },
    });

    for (const p of seed.pricing || []) {
      await prisma.documentPricing.upsert({
        where: { categoryId_documentType: { categoryId: cat.id, documentType: p.type } },
        update: { basePrice: p.price, notes: p.notes ?? null, isActive: true },
        create: {
          id: uuid(),
          categoryId: cat.id,
          documentType: p.type,
          basePrice: p.price,
          notes: p.notes ?? null,
          isActive: true,
        },
      });
    }
  }
  console.log(`✅ Vehicle categories + pricing seeded (${CATEGORY_SEEDS.length} categories)`);

  // Default service fee rate — 15% VAT-inclusive. Admin can edit from settings.
  await prisma.systemConfig.upsert({
    where: { key: 'service_fee_rate' },
    update: {},
    create: { id: uuid(), key: 'service_fee_rate', value: '0.15' },
  });
  console.log('✅ Service fee rate set to 15% (VAT inclusive)');

}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

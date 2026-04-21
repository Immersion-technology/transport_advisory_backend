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

  // Demo user
  const demoEmail = 'demo@transportadvisory.ng';
  const existingDemo = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!existingDemo) {
    const demoPwd = await bcrypt.hash('Demo@2026', 12);
    const demo = await prisma.user.create({
      data: {
        id: uuid(),
        email: demoEmail,
        phone: '08012345678',
        password: demoPwd,
        firstName: 'Adebayo',
        lastName: 'Okafor',
        subscriptionTier: 'FOUNDING_FREE',
        subscriberNumber: 1,
        emailVerified: true,
      },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        id: uuid(),
        userId: demo.id,
        plateNumber: 'LAG 234 AB',
        make: 'Toyota',
        model: 'Camry',
        year: 2019,
        stateOfRegistration: 'Lagos',
      },
    });

    const in45Days = new Date(); in45Days.setDate(in45Days.getDate() + 45);
    const in5Days = new Date(); in5Days.setDate(in5Days.getDate() + 5);
    const in120Days = new Date(); in120Days.setDate(in120Days.getDate() + 120);

    await prisma.document.createMany({
      data: [
        { id: uuid(), vehicleId: vehicle.id, type: 'MOTOR_INSURANCE', expiryDate: in45Days, isAutoPopulated: true },
        { id: uuid(), vehicleId: vehicle.id, type: 'VEHICLE_LICENSE', expiryDate: in5Days },
        { id: uuid(), vehicleId: vehicle.id, type: 'ROADWORTHINESS', expiryDate: in120Days },
      ],
    });

    console.log('✅ Demo user created:', demo.email, '(password: Demo@2026)');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

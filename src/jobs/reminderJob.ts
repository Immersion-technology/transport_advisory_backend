import cron from 'node-cron';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendEmail, buildReminderEmail } from '../services/emailService';
import { sendSMS, buildReminderSMS } from '../services/smsService';
import { format, differenceInDays } from 'date-fns';

const TRIGGER_DAYS = [30, 7, 1, 0];

const docTypeLabels: Record<string, string> = {
  MOTOR_INSURANCE: 'Motor Insurance',
  VEHICLE_LICENSE: 'Vehicle License',
  ROADWORTHINESS: 'Roadworthiness Certificate',
  HACKNEY_PERMIT: 'Hackney Permit',
};

export const processReminders = async () => {
  console.log('[ReminderJob] Starting daily reminder scan...');

  try {
    const now = new Date();
    const documents = await prisma.document.findMany({
      where: {
        vehicle: { isActive: true },
      },
      include: {
        vehicle: {
          include: {
            user: {
              include: { reminderPrefs: true },
            },
          },
        },
      },
    });

    let sent = 0;

    for (const doc of documents) {
      const daysLeft = differenceInDays(doc.expiryDate, now);

      if (!TRIGGER_DAYS.includes(daysLeft)) continue;

      const user = doc.vehicle.user;
      const confirmToken = uuid();
      const expiryFormatted = format(doc.expiryDate, 'dd MMM yyyy');
      const renewalLink = `${process.env.FRONTEND_URL}/applications/new?vehicleId=${doc.vehicleId}&type=${doc.type}`;

      // Log the reminder
      await prisma.reminderLog.create({
        data: {
          id: uuid(),
          documentId: doc.id,
          triggerDays: daysLeft,
          channel: 'EMAIL',
          confirmToken,
        },
      });

      // Send email
      try {
        const html = buildReminderEmail({
          firstName: user.firstName,
          plateNumber: doc.vehicle.plateNumber,
          documentType: docTypeLabels[doc.type] || doc.type,
          expiryDate: expiryFormatted,
          daysLeft,
          confirmToken,
          renewalLink,
        });
        await sendEmail({
          to: user.email,
          subject: daysLeft === 0
            ? `URGENT: Your ${docTypeLabels[doc.type]} has expired`
            : `Reminder: ${docTypeLabels[doc.type]} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
          html,
        });
      } catch (err) {
        console.error(`[ReminderJob] Email failed for ${user.email}:`, err);
      }

      // Send SMS
      try {
        const message = buildReminderSMS({
          firstName: user.firstName,
          plateNumber: doc.vehicle.plateNumber,
          documentType: docTypeLabels[doc.type] || doc.type,
          expiryDate: expiryFormatted,
          daysLeft,
        });
        await sendSMS(user.phone, message);
      } catch (err) {
        console.error(`[ReminderJob] SMS failed for ${user.phone}:`, err);
      }

      sent++;
    }

    console.log(`[ReminderJob] Completed. Sent ${sent} reminders.`);
  } catch (error) {
    console.error('[ReminderJob] Error:', error);
  }
};

export const startReminderJob = () => {
  // Run daily at 08:00 WAT (07:00 UTC)
  cron.schedule('0 7 * * *', processReminders, { timezone: 'Africa/Lagos' });
  console.log('[ReminderJob] Scheduled daily at 08:00 WAT');
};

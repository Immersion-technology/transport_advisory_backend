import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { uploadFile } from '../services/cloudinaryService';
import { sendEmail, buildAccountStatusEmail } from '../services/emailService';
import { sendSMS } from '../services/smsService';

export const getDashboardStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalUsers, totalVehicles, pendingApplications, totalApplications, deliveries] = await Promise.all([
      prisma.user.count(),
      prisma.vehicle.count({ where: { isActive: true } }),
      prisma.application.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'SUBMITTED'] } } }),
      prisma.application.count(),
      prisma.delivery.count({ where: { status: { in: ['PENDING', 'DISPATCHED'] } } }),
    ]);

    const revenue = await prisma.application.aggregate({
      where: { isPaid: true },
      _sum: { serviceFee: true },
    });

    const unconfirmedReminders = await prisma.reminderLog.count({
      where: { isConfirmed: false, triggerDays: { in: [7, 30] } },
    });

    sendSuccess(res, 'Stats fetched', {
      totalUsers,
      totalVehicles,
      pendingApplications,
      totalApplications,
      activeDeliveries: deliveries,
      totalRevenue: revenue._sum.serviceFee || 0,
      unconfirmedReminders,
    });
  } catch (error) {
    sendError(res, 'Failed to fetch stats', 500);
  }
};

export const getAllApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);
    const where = status ? { status: status as 'PENDING' } : {};

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          vehicle: { select: { plateNumber: true, make: true, model: true, year: true } },
          delivery: true,
          documents: true,
          statusHistory: { orderBy: { changedAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.application.count({ where }),
    ]);

    sendSuccess(res, 'Applications fetched', applications, 200, {
      page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    sendError(res, 'Failed to fetch applications', 500);
  }
};

export const updateApplicationStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const application = await prisma.application.update({
      where: { id },
      data: { status },
      include: {
        user: true,
        vehicle: { select: { plateNumber: true } },
      },
    });

    await prisma.applicationStatusHistory.create({
      data: { id: uuid(), applicationId: id, status, notes, changedBy: req.user!.id },
    });

    // Notify user
    const statusMessages: Record<string, string> = {
      PROCESSING: 'Your application is being processed',
      SUBMITTED: 'Your application has been submitted to the relevant authority',
      READY: 'Your document is ready for download/delivery',
      DELIVERED: 'Your document has been delivered',
    };

    if (statusMessages[status]) {
      try {
        await sendEmail({
          to: application.user.email,
          subject: `Application Update — ${application.documentType.replace('_', ' ')}`,
          html: `<p>Dear ${application.user.firstName},</p><p>${statusMessages[status]} for vehicle ${application.vehicle.plateNumber}.</p>${notes ? `<p>Note: ${notes}</p>` : ''}<p>Visit <a href="${process.env.FRONTEND_URL}/applications/${id}">your dashboard</a> for details.</p>`,
        });
      } catch (_) { /* Non-blocking */ }
    }

    sendSuccess(res, 'Status updated', application);
  } catch (error) {
    sendError(res, 'Failed to update status', 500);
  }
};

export const uploadCompletedDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) { sendError(res, 'No file uploaded', 400); return; }

    const { publicId, downloadUrl } = await uploadFile(file.buffer, `completed/${id}`, 'raw', file.originalname);

    const application = await prisma.application.update({
      where: { id },
      data: {
        completedFileUrl: downloadUrl,
        completedFilePublicId: publicId,
        completedAt: new Date(),
        status: 'READY',
      },
      include: {
        user: true,
        vehicle: { select: { plateNumber: true } },
      },
    });

    await prisma.applicationStatusHistory.create({
      data: { id: uuid(), applicationId: id, status: 'READY', notes: 'Document uploaded by admin', changedBy: req.user!.id },
    });

    try {
      await sendEmail({
        to: application.user.email,
        subject: 'Your Document is Ready — Transport Advisory',
        html: `<p>Dear ${application.user.firstName},</p><p>Your ${application.documentType.replace('_', ' ')} for vehicle ${application.vehicle.plateNumber} is ready. <a href="${process.env.FRONTEND_URL}/applications/${id}">Download it now</a>.</p>`,
      });
    } catch (_) { /* Non-blocking */ }

    sendSuccess(res, 'Document uploaded', { fileUrl: downloadUrl });
  } catch (error) {
    sendError(res, 'Failed to upload document', 500);
  }
};

export const getUnconfirmedReminders = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const unconfirmed = await prisma.reminderLog.findMany({
      where: {
        isConfirmed: false,
        triggerDays: { in: [7, 30] },
        sentAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      include: {
        document: {
          include: {
            vehicle: {
              include: {
                user: { select: { firstName: true, lastName: true, email: true, phone: true } },
              },
            },
          },
        },
      },
      orderBy: { sentAt: 'asc' },
    });
    sendSuccess(res, 'Unconfirmed reminders fetched', unconfirmed);
  } catch (error) {
    sendError(res, 'Failed to fetch unconfirmed reminders', 500);
  }
};

export const getAllUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true, email: true, phone: true, firstName: true, lastName: true,
          role: true, subscriptionTier: true, subscriberNumber: true,
          isActive: true, createdAt: true,
          _count: { select: { vehicles: true, applications: true } },
        },
        orderBy: { subscriberNumber: 'asc' },
        skip,
        take: Number(limit),
      }),
      prisma.user.count(),
    ]);

    sendSuccess(res, 'Users fetched', users, 200, {
      page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    sendError(res, 'Failed to fetch users', 500);
  }
};

export const getAllDeliveries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query as Record<string, string>;
    const where = status ? { status: status as any } : {};

    const deliveries = await prisma.delivery.findMany({
      where,
      include: {
        application: {
          include: {
            user: { select: { firstName: true, lastName: true, email: true, phone: true } },
            vehicle: { select: { plateNumber: true, make: true, model: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, 'Deliveries fetched', deliveries);
  } catch (error) {
    sendError(res, 'Failed to fetch deliveries', 500);
  }
};

export const getApplicationDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, subscriberNumber: true, subscriptionTier: true } },
        vehicle: true,
        delivery: true,
        documents: true,
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
    });
    if (!application) { sendError(res, 'Application not found', 404); return; }
    sendSuccess(res, 'Application fetched', application);
  } catch (error) {
    sendError(res, 'Failed to fetch application', 500);
  }
};

export const updateUserStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body as { action: 'SUSPEND' | 'BLOCK' | 'ACTIVATE'; reason?: string };

    if (!['SUSPEND', 'BLOCK', 'ACTIVATE'].includes(action)) {
      sendError(res, 'Invalid action. Must be SUSPEND, BLOCK, or ACTIVATE.', 400); return;
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) { sendError(res, 'User not found', 404); return; }
    if (target.role === 'ADMIN') { sendError(res, 'Admin accounts cannot be suspended via this endpoint.', 403); return; }

    const isActive = action === 'ACTIVATE';
    const updated = await prisma.user.update({
      where: { id },
      data: {
        isActive,
        suspensionReason: isActive ? null : (reason ?? null),
      },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true, suspensionReason: true },
    });

    const emailAction = action === 'ACTIVATE' ? 'ACTIVATED' : action === 'SUSPEND' ? 'SUSPENDED' : 'BLOCKED';
    try {
      await sendEmail({
        to: target.email,
        subject: emailAction === 'ACTIVATED'
          ? 'Your Transport Advisory Services account has been reactivated'
          : `Your Transport Advisory Services account has been ${emailAction.toLowerCase()}`,
        html: buildAccountStatusEmail({ firstName: target.firstName, action: emailAction, reason }),
      });
    } catch (_) {
      // Email failure must not block the status update response
    }

    sendSuccess(res, `User ${action.toLowerCase()}d successfully`, updated);
  } catch (error) {
    sendError(res, 'Failed to update user status', 500);
  }
};

export const updateDeliveryStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, trackingCode } = req.body;

    const delivery = await prisma.delivery.update({
      where: { id },
      data: {
        status,
        trackingCode,
        ...(status === 'DISPATCHED' && { dispatchedAt: new Date() }),
        ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
      },
    });
    sendSuccess(res, 'Delivery status updated', delivery);
  } catch (error) {
    sendError(res, 'Failed to update delivery', 500);
  }
};

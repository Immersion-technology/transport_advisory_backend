import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { uploadFile } from '../services/cloudinaryService';
import { initializeTransaction, verifyTransaction } from '../services/paystackService';

// Fee schedule — renewal vs fresh
const RENEWAL_FEES: Record<string, { gov: number; service: number }> = {
  ROADWORTHINESS: { gov: 12000, service: 2000 },
  VEHICLE_LICENSE: { gov: 15000, service: 2500 },
  MOTOR_INSURANCE: { gov: 15000, service: 1500 },
  HACKNEY_PERMIT: { gov: 0, service: 2500 },
};
const FRESH_FEES: Record<string, { gov: number; service: number }> = {
  ROADWORTHINESS: { gov: 12000, service: 3500 },
  VEHICLE_LICENSE: { gov: 15000, service: 3500 },
  MOTOR_INSURANCE: { gov: 15000, service: 3500 },
  HACKNEY_PERMIT: { gov: 0, service: 3500 },
};

export const createApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vehicleId, documentType, kind = 'RENEWAL', deliveryTier, deliveryAddress, deliveryCity, deliveryState, recipientName, recipientPhone } = req.body;

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, userId: req.user!.id },
    });
    if (!vehicle) { sendError(res, 'Vehicle not found', 404); return; }

    // Prevent duplicate active applications for the same vehicle + document type
    const active = await prisma.application.findFirst({
      where: {
        vehicleId,
        documentType,
        status: { in: ['PENDING', 'PROCESSING', 'SUBMITTED', 'READY'] },
      },
    });
    if (active) {
      sendError(res, `An active application for this document already exists (status: ${active.status}). Complete or cancel it before creating a new one.`, 409);
      return;
    }

    const feeTable = kind === 'FRESH' ? FRESH_FEES : RENEWAL_FEES;
    const fees = feeTable[documentType] || { gov: 0, service: 3500 };
    const deliveryFee = deliveryTier === 'SAME_DAY' ? 8000 : deliveryTier === 'EXPRESS' ? 4500 : deliveryTier === 'STANDARD' ? 2000 : 0;
    const total = fees.gov + fees.service + deliveryFee;

    const application = await prisma.application.create({
      data: {
        id: uuid(),
        userId: req.user!.id,
        vehicleId,
        documentType,
        kind,
        governmentFee: fees.gov,
        serviceFee: fees.service,
        totalAmount: total,
        ...(deliveryTier && {
          delivery: {
            create: {
              id: uuid(),
              tier: deliveryTier,
              fee: deliveryFee,
              address: deliveryAddress,
              city: deliveryCity,
              state: deliveryState,
              recipientName,
              recipientPhone,
            },
          },
        }),
        statusHistory: {
          create: { id: uuid(), status: 'PENDING', notes: 'Application created' },
        },
      },
      include: { vehicle: true, delivery: true },
    });

    sendSuccess(res, 'Application created', application, 201);
  } catch (error) {
    console.error('Create application error:', error);
    sendError(res, 'Failed to create application', 500);
  }
};

export const uploadApplicationDocs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { applicationId } = req.params;
    const files = req.files as Express.Multer.File[];

    const application = await prisma.application.findFirst({
      where: { id: applicationId, userId: req.user!.id },
    });
    if (!application) { sendError(res, 'Application not found', 404); return; }

    const uploaded = await Promise.all(
      files.map(async (file) => {
        const { downloadUrl, publicId } = await uploadFile(file.buffer, `applications/${applicationId}`, 'auto', file.originalname);
        return prisma.applicationDocument.create({
          data: {
            id: uuid(),
            applicationId,
            fileName: file.originalname,
            fileUrl: downloadUrl,
            filePublicId: publicId,
            fileType: file.mimetype,
          },
        });
      })
    );

    sendSuccess(res, 'Documents uploaded', uploaded);
  } catch (error) {
    sendError(res, 'Failed to upload documents', 500);
  }
};

export const initPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { applicationId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const application = await prisma.application.findFirst({
      where: { id: applicationId, userId: req.user!.id },
    });
    if (!application || !user) { sendError(res, 'Application not found', 404); return; }
    if (application.isPaid) { sendError(res, 'Already paid', 400); return; }

    const ref = `TA-${applicationId.slice(0, 8).toUpperCase()}-${Date.now()}`;
    const { authorizationUrl, reference } = await initializeTransaction({
      email: user.email,
      amount: application.totalAmount,
      reference: ref,
      metadata: { applicationId, userId: user.id },
      callback_url: `${process.env.FRONTEND_URL}/applications/${applicationId}/payment-callback`,
    });

    await prisma.application.update({
      where: { id: applicationId },
      data: { paystackRef: reference },
    });

    sendSuccess(res, 'Payment initialized', { authorizationUrl, reference });
  } catch (error) {
    sendError(res, 'Failed to initialize payment', 500);
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { reference } = req.params;
    const { status } = await verifyTransaction(reference);

    if (status === 'success') {
      const application = await prisma.application.findFirst({
        where: { paystackRef: reference },
      });
      if (!application) { sendError(res, 'Application not found', 404); return; }

      await prisma.application.update({
        where: { id: application.id },
        data: { isPaid: true, paidAt: new Date(), status: 'PROCESSING' },
      });
      await prisma.applicationStatusHistory.create({
        data: { id: uuid(), applicationId: application.id, status: 'PROCESSING', notes: 'Payment confirmed' },
      });
      sendSuccess(res, 'Payment verified successfully', { status: 'success' });
    } else {
      sendError(res, 'Payment not successful', 400);
    }
  } catch (error) {
    sendError(res, 'Failed to verify payment', 500);
  }
};

export const getApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const applications = await prisma.application.findMany({
      where: { userId: req.user!.id },
      include: {
        vehicle: { select: { plateNumber: true, make: true, model: true } },
        delivery: true,
        documents: true,
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, 'Applications fetched', applications);
  } catch (error) {
    sendError(res, 'Failed to fetch applications', 500);
  }
};

export const getApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
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

import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { uploadFile } from '../services/cloudinaryService';
import { initializeTransaction, verifyTransaction } from '../services/paystackService';
import { quoteForCategoryDocument } from '../services/pricingService';

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

    // Pricing is driven by (vehicle.category, documentType). Renewals on
    // unverified vehicles still create the application, but with totalAmount=0
    // — payment is gated until admin verifies and assigns a category.
    const deliveryFee = deliveryTier === 'SAME_DAY' ? 8000 : deliveryTier === 'EXPRESS' ? 4500 : deliveryTier === 'STANDARD' ? 3000 : 0;
    let governmentFee = 0;
    let serviceFee = 0;
    let total = 0;
    let pricingNotes: string | null = null;

    if (vehicle.categoryId && (kind === 'FRESH' || vehicle.isVerified)) {
      try {
        const quote = await quoteForCategoryDocument(vehicle.categoryId, documentType);
        governmentFee = quote.basePrice;
        serviceFee = quote.serviceFee;
        total = quote.total + deliveryFee;
        pricingNotes = quote.notes ?? null;
      } catch (err: any) {
        sendError(res, err.message || 'Pricing not available for this category and document.', 400);
        return;
      }
    } else if (kind === 'FRESH') {
      sendError(res, 'Vehicle category is required for new applications. Add the vehicle with category before creating the application.', 400);
      return;
    }

    const application = await prisma.application.create({
      data: {
        id: uuid(),
        userId: req.user!.id,
        vehicleId,
        documentType,
        kind,
        governmentFee,
        serviceFee,
        totalAmount: total,
        notes: pricingNotes,
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
    const files = req.files as Array<{ originalname: string; buffer: Buffer; mimetype: string; size: number }>;

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
      include: { vehicle: true, delivery: true },
    });
    if (!application || !user) { sendError(res, 'Application not found', 404); return; }
    if (application.isPaid) { sendError(res, 'Already paid', 400); return; }

    // Renewal payments are gated on admin verification of the vehicle. For
    // unverified vehicles we don't yet have category-based pricing, so the
    // total is still 0 — we recompute it on-demand here so a freshly verified
    // vehicle becomes payable without the user re-submitting.
    if (!application.vehicle.isVerified) {
      sendError(
        res,
        'This vehicle is awaiting admin verification. We\'ll email you as soon as it\'s ready to pay.',
        409,
      );
      return;
    }
    if (application.totalAmount === 0 && application.vehicle.categoryId) {
      try {
        const quote = await quoteForCategoryDocument(application.vehicle.categoryId, application.documentType);
        const deliveryFee = application.delivery?.fee || 0;
        const newTotal = quote.total + deliveryFee;
        await prisma.application.update({
          where: { id: application.id },
          data: {
            governmentFee: quote.basePrice,
            serviceFee: quote.serviceFee,
            totalAmount: newTotal,
            notes: quote.notes ?? application.notes,
          },
        });
        application.governmentFee = quote.basePrice;
        application.serviceFee = quote.serviceFee;
        application.totalAmount = newTotal;
      } catch (err: any) {
        sendError(res, err.message || 'Pricing not configured for this vehicle category.', 400);
        return;
      }
    }
    if (application.totalAmount <= 0) {
      sendError(res, 'Application total is not yet computed. Please wait for admin pricing setup.', 409);
      return;
    }

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

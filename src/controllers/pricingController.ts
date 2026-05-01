import { Request, Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { getFullPricingMatrix, setServiceFeeRate, getServiceFeeRate } from '../services/pricingService';

const DOC_TYPES = ['MOTOR_INSURANCE', 'VEHICLE_LICENSE', 'ROADWORTHINESS', 'HACKNEY_PERMIT', 'CHANGE_OF_OWNERSHIP'] as const;
type DocType = typeof DOC_TYPES[number];

/**
 * Public — anyone can read pricing (used by /start to show estimates).
 * Returns active categories and their (documentType → basePrice) entries
 * along with the current service-fee rate.
 */
export const getPublicPricing = async (_req: Request, res: Response): Promise<void> => {
  try {
    const matrix = await getFullPricingMatrix();
    sendSuccess(res, 'Pricing matrix', matrix);
  } catch (err) {
    console.error('Public pricing error:', err);
    sendError(res, 'Failed to load pricing', 500);
  }
};

/**
 * Admin — list every category (including inactive ones) with full pricing
 * detail for the admin pricing page.
 */
export const getAdminPricing = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [categories, rateRow] = await Promise.all([
      prisma.vehicleCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { pricing: true },
      }),
      prisma.systemConfig.findUnique({ where: { key: 'service_fee_rate' } }),
    ]);
    sendSuccess(res, 'Admin pricing', {
      categories,
      serviceFeeRate: rateRow ? Number(rateRow.value) : 0.15,
    });
  } catch (err) {
    sendError(res, 'Failed to load admin pricing', 500);
  }
};

/** Admin — create or update a single (category, document) pricing entry. */
export const upsertPricing = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { categoryId, documentType, basePrice, notes, isActive } = req.body;
    if (!categoryId || !documentType || basePrice === undefined) {
      sendError(res, 'categoryId, documentType and basePrice are required', 400);
      return;
    }
    if (!DOC_TYPES.includes(documentType)) {
      sendError(res, `documentType must be one of: ${DOC_TYPES.join(', ')}`, 400);
      return;
    }
    const price = Number(basePrice);
    if (!Number.isFinite(price) || price < 0) {
      sendError(res, 'basePrice must be a non-negative number', 400);
      return;
    }

    const category = await prisma.vehicleCategory.findUnique({ where: { id: categoryId } });
    if (!category) { sendError(res, 'Category not found', 404); return; }

    const row = await prisma.documentPricing.upsert({
      where: { categoryId_documentType: { categoryId, documentType: documentType as DocType } },
      update: {
        basePrice: price,
        notes: notes ?? null,
        isActive: isActive ?? true,
      },
      create: {
        id: uuid(),
        categoryId,
        documentType: documentType as DocType,
        basePrice: price,
        notes: notes ?? null,
        isActive: isActive ?? true,
      },
    });
    sendSuccess(res, 'Pricing saved', row);
  } catch (err) {
    console.error('upsertPricing error:', err);
    sendError(res, 'Failed to save pricing', 500);
  }
};

/** Admin — create a new vehicle category. */
export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { key, label, description, sortOrder } = req.body;
    if (!key || !label) {
      sendError(res, 'key and label are required', 400);
      return;
    }
    const cat = await prisma.vehicleCategory.create({
      data: {
        id: uuid(),
        key: String(key).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        label: String(label),
        description: description ?? null,
        sortOrder: Number(sortOrder) || 0,
      },
    });
    sendSuccess(res, 'Category created', cat, 201);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      sendError(res, 'A category with that key already exists', 409);
      return;
    }
    sendError(res, 'Failed to create category', 500);
  }
};

/** Admin — update a vehicle category's label / activation / sort order. */
export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { label, description, sortOrder, isActive } = req.body;
    const cat = await prisma.vehicleCategory.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label: String(label) } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });
    sendSuccess(res, 'Category updated', cat);
  } catch (err) {
    sendError(res, 'Failed to update category', 500);
  }
};

/** Admin — set the global service-fee rate (e.g. 0.15 = 15%, VAT-inclusive). */
export const updateServiceFeeRate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rate } = req.body;
    const parsed = Number(rate);
    if (!Number.isFinite(parsed)) { sendError(res, 'rate must be a number', 400); return; }
    await setServiceFeeRate(parsed);
    const newRate = await getServiceFeeRate();
    sendSuccess(res, 'Service fee rate updated', { rate: newRate });
  } catch (err: any) {
    sendError(res, err.message || 'Failed to update service fee rate', 400);
  }
};

/**
 * Admin — verify a vehicle. Populates the fields admin gathers from the
 * external check websites (NIID / AutoReg / DVIS) and flips isVerified=true,
 * unblocking the user's renewal payment.
 *
 * Body: any subset of make, model, year, stateOfRegistration, colour,
 * chassisNumber, engineNumber, registrationNumber, rwcNumber, categoryId.
 * Plus optional `documents`: [{ type, expiryDate }] to upsert document expiries.
 */
export const verifyVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      make, model, year, stateOfRegistration, colour,
      chassisNumber, engineNumber, registrationNumber, rwcNumber,
      categoryId, documents,
    } = req.body;

    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) { sendError(res, 'Vehicle not found', 404); return; }

    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        ...(make !== undefined ? { make } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(year !== undefined ? { year: year ? Number(year) : null } : {}),
        ...(stateOfRegistration !== undefined ? { stateOfRegistration } : {}),
        ...(colour !== undefined ? { colour } : {}),
        ...(chassisNumber !== undefined ? { chassisNumber } : {}),
        ...(engineNumber !== undefined ? { engineNumber } : {}),
        ...(registrationNumber !== undefined ? { registrationNumber } : {}),
        ...(rwcNumber !== undefined ? { rwcNumber } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        isVerified: true,
        verifiedAt: new Date(),
        verifiedById: req.user!.id,
      },
    });

    // Upsert any document expirations the admin filled in
    if (Array.isArray(documents)) {
      for (const doc of documents) {
        if (!doc?.type || !doc?.expiryDate) continue;
        const expiry = new Date(doc.expiryDate);
        if (Number.isNaN(expiry.getTime())) continue;
        await prisma.document.upsert({
          where: { vehicleId_type: { vehicleId: id, type: doc.type } },
          update: { expiryDate: expiry, notes: doc.notes ?? null },
          create: {
            id: uuid(),
            vehicleId: id,
            type: doc.type,
            expiryDate: expiry,
            notes: doc.notes ?? null,
          },
        });
      }
    }

    sendSuccess(res, 'Vehicle verified', updated);
  } catch (err) {
    console.error('verifyVehicle error:', err);
    sendError(res, 'Failed to verify vehicle', 500);
  }
};

/** Admin — list every unverified vehicle (the verification queue). */
export const listUnverifiedVehicles = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { isVerified: false, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        applications: {
          where: { status: 'PENDING' },
          select: { id: true, kind: true, documentType: true, createdAt: true },
        },
      },
    });
    sendSuccess(res, 'Unverified vehicles', vehicles);
  } catch (err) {
    sendError(res, 'Failed to load unverified vehicles', 500);
  }
};

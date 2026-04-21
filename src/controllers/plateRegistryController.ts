import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';

// --- Helpers to convert date strings into Date or null ---
const toDate = (v: unknown) => (v ? new Date(v as string) : null);

// --- Admin: list all registry entries ---
export const getRegistryEntries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = '1', limit = '50' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);

    const where = search
      ? {
          OR: [
            { plateNumber: { contains: search.toUpperCase() } },
            { ownerName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [entries, total] = await Promise.all([
      prisma.plateRegistry.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.plateRegistry.count({ where }),
    ]);

    sendSuccess(res, 'Registry entries fetched', entries, 200, {
      page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    sendError(res, 'Failed to fetch registry', 500);
  }
};

// --- Admin: create or update entry ---
export const upsertRegistryEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, any>;
    const plateNumber = (body.plateNumber || '').toUpperCase().trim();
    if (!plateNumber) { sendError(res, 'Plate number is required', 400); return; }

    const data = {
      make: body.make || null,
      model: body.model || null,
      year: body.year ? Number(body.year) : null,
      color: body.color || null,
      registeredState: body.registeredState || null,
      ownerName: body.ownerName || null,

      insurer: body.insurer || null,
      policyNumber: body.policyNumber || null,
      insuranceStartDate: toDate(body.insuranceStartDate),
      insuranceExpiryDate: toDate(body.insuranceExpiryDate),
      insuranceCoverType: body.insuranceCoverType || null,
      insuranceStatus: body.insuranceStatus || null,

      licenseNumber: body.licenseNumber || null,
      licenseIssueDate: toDate(body.licenseIssueDate),
      licenseExpiryDate: toDate(body.licenseExpiryDate),
      licenseStatus: body.licenseStatus || null,

      rwCertNumber: body.rwCertNumber || null,
      rwInspectionDate: toDate(body.rwInspectionDate),
      rwExpiryDate: toDate(body.rwExpiryDate),
      rwStatus: body.rwStatus || null,

      hackneyPermitNumber: body.hackneyPermitNumber || null,
      hackneyIssueDate: toDate(body.hackneyIssueDate),
      hackneyExpiryDate: toDate(body.hackneyExpiryDate),
      hackneyOperator: body.hackneyOperator || null,
      hackneyStatus: body.hackneyStatus || null,

      notes: body.notes || null,
    };

    const entry = await prisma.plateRegistry.upsert({
      where: { plateNumber },
      create: { id: uuid(), plateNumber, createdById: req.user!.id, ...data },
      update: data,
    });

    sendSuccess(res, 'Registry entry saved', entry);
  } catch (error) {
    console.error('Upsert plate registry error:', error);
    sendError(res, 'Failed to save entry', 500);
  }
};

// --- Admin: bulk seed entries from user's existing vehicles ---
export const seedFromUserVehicles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const vehicles = await prisma.vehicle.findMany({
      where: { userId, isActive: true },
      include: {
        documents: true,
        user: true,
      },
    });
    if (!vehicles.length) { sendError(res, 'User has no vehicles', 404); return; }

    const results = await Promise.all(vehicles.map(v => {
      const insurance = v.documents.find(d => d.type === 'MOTOR_INSURANCE');
      const license = v.documents.find(d => d.type === 'VEHICLE_LICENSE');
      const rw = v.documents.find(d => d.type === 'ROADWORTHINESS');
      const hp = v.documents.find(d => d.type === 'HACKNEY_PERMIT');

      const data = {
        make: v.make,
        model: v.model,
        year: v.year,
        registeredState: v.stateOfRegistration,
        ownerName: `${v.user.firstName} ${v.user.lastName}`,
        insuranceExpiryDate: insurance?.expiryDate || null,
        licenseExpiryDate: license?.expiryDate || null,
        rwExpiryDate: rw?.expiryDate || null,
        hackneyExpiryDate: hp?.expiryDate || null,
      };

      return prisma.plateRegistry.upsert({
        where: { plateNumber: v.plateNumber },
        create: { id: uuid(), plateNumber: v.plateNumber, createdById: req.user!.id, ...data },
        update: data,
      });
    }));

    sendSuccess(res, `Seeded ${results.length} plate entries from user vehicles`, results);
  } catch (error) {
    console.error('Seed plate registry error:', error);
    sendError(res, 'Failed to seed registry', 500);
  }
};

// --- Admin: delete entry ---
export const deleteRegistryEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.plateRegistry.delete({ where: { id: req.params.id } });
    sendSuccess(res, 'Entry removed');
  } catch (error) {
    sendError(res, 'Failed to remove entry', 500);
  }
};

// --- Public/user: lookup a plate in the registry ---
export const lookupPlate = async (plateNumber: string) => {
  return prisma.plateRegistry.findUnique({
    where: { plateNumber: plateNumber.toUpperCase().trim() },
  });
};

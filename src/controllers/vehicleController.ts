import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { lookupNIID } from '../services/niidService';

export const addVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { plateNumber, make, model, year, stateOfRegistration } = req.body;
    const userId = req.user!.id;

    const existing = await prisma.vehicle.findUnique({
      where: { userId_plateNumber: { userId, plateNumber: plateNumber.toUpperCase() } },
    });
    if (existing) {
      sendError(res, 'Vehicle with this plate number already registered', 400);
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const vehicleCount = await prisma.vehicle.count({ where: { userId, isActive: true } });
    const limit = user?.subscriptionTier === 'FLEET' ? 20 : 3;
    if (vehicleCount >= limit) {
      sendError(res, `Your subscription allows up to ${limit} vehicles`, 400);
      return;
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        id: uuid(),
        userId,
        plateNumber: plateNumber.toUpperCase(),
        make,
        model,
        year: Number(year),
        stateOfRegistration,
      },
    });

    sendSuccess(res, 'Vehicle added successfully', vehicle, 201);
  } catch (error) {
    console.error('Add vehicle error:', error);
    sendError(res, 'Failed to add vehicle', 500);
  }
};

export const lookupPlate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { plateNumber } = req.params;
    const result = await lookupNIID(plateNumber);
    sendSuccess(res, 'NIID lookup complete', result);
  } catch (error) {
    sendError(res, 'NIID lookup failed', 500);
  }
};

export const getVehicles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { userId: req.user!.id, isActive: true },
      include: {
        documents: {
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, 'Vehicles fetched', vehicles);
  } catch (error) {
    sendError(res, 'Failed to fetch vehicles', 500);
  }
};

export const getVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        documents: true,
        applications: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!vehicle) { sendError(res, 'Vehicle not found', 404); return; }
    sendSuccess(res, 'Vehicle fetched', vehicle);
  } catch (error) {
    sendError(res, 'Failed to fetch vehicle', 500);
  }
};

export const updateVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { make, model, year, stateOfRegistration } = req.body;
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!vehicle) { sendError(res, 'Vehicle not found', 404); return; }

    const updated = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: { make, model, year: Number(year), stateOfRegistration },
    });
    sendSuccess(res, 'Vehicle updated', updated);
  } catch (error) {
    sendError(res, 'Failed to update vehicle', 500);
  }
};

export const deleteVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!vehicle) { sendError(res, 'Vehicle not found', 404); return; }

    await prisma.vehicle.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    sendSuccess(res, 'Vehicle removed');
  } catch (error) {
    sendError(res, 'Failed to remove vehicle', 500);
  }
};

// Document management for a vehicle
export const upsertDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vehicleId, type, expiryDate } = req.body;

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, userId: req.user!.id },
    });
    if (!vehicle) { sendError(res, 'Vehicle not found', 404); return; }

    const doc = await prisma.document.upsert({
      where: { vehicleId_type: { vehicleId, type } },
      create: { id: uuid(), vehicleId, type, expiryDate: new Date(expiryDate) },
      update: { expiryDate: new Date(expiryDate) },
    });

    sendSuccess(res, 'Document saved', doc);
  } catch (error) {
    sendError(res, 'Failed to save document', 500);
  }
};

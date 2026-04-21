import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { lookupNIID } from '../services/niidService';
import { lookupPlate as lookupPlateRegistry } from './plateRegistryController';

export const initiateVerification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { plateNumber } = req.body;
    if (!plateNumber) {
      sendError(res, 'Plate number is required', 400);
      return;
    }

    const userId = req.user?.id;
    const plate = plateNumber.toUpperCase().trim();

    // 1. Try live NIID scraper
    const niidResult = await lookupNIID(plate);

    // 2. Always also check our curated registry (parallel fallback data)
    const registryEntry = await lookupPlateRegistry(plate);

    const insurance = niidResult.status === 'found'
      ? { source: 'NIID_LIVE', ...niidResult }
      : registryEntry
        ? {
            source: 'TRANSPORT_ADVISORY_DB',
            status: 'found',
            insurer: registryEntry.insurer || '',
            policyNumber: registryEntry.policyNumber || '',
            expiryDate: registryEntry.insuranceExpiryDate?.toISOString().split('T')[0] || null,
            coverType: registryEntry.insuranceCoverType || 'Third Party',
          }
        : { source: 'NONE', ...niidResult };

    const vehicleInfo = registryEntry ? {
      make: registryEntry.make,
      model: registryEntry.model,
      year: registryEntry.year,
      color: registryEntry.color,
      registeredState: registryEntry.registeredState,
      ownerName: registryEntry.ownerName,
    } : null;

    const license = registryEntry && registryEntry.licenseExpiryDate ? {
      source: 'TRANSPORT_ADVISORY_DB',
      status: 'found',
      licenseNumber: registryEntry.licenseNumber,
      issueDate: registryEntry.licenseIssueDate?.toISOString().split('T')[0] || null,
      expiryDate: registryEntry.licenseExpiryDate.toISOString().split('T')[0],
      statusFlag: registryEntry.licenseStatus || 'Active',
    } : null;

    const roadworthiness = registryEntry && registryEntry.rwExpiryDate ? {
      source: 'TRANSPORT_ADVISORY_DB',
      status: 'found',
      certNumber: registryEntry.rwCertNumber,
      inspectionDate: registryEntry.rwInspectionDate?.toISOString().split('T')[0] || null,
      expiryDate: registryEntry.rwExpiryDate.toISOString().split('T')[0],
      statusFlag: registryEntry.rwStatus || 'Active',
    } : null;

    const hackneyPermit = registryEntry && registryEntry.hackneyExpiryDate ? {
      source: 'TRANSPORT_ADVISORY_DB',
      status: 'found',
      permitNumber: registryEntry.hackneyPermitNumber,
      issueDate: registryEntry.hackneyIssueDate?.toISOString().split('T')[0] || null,
      expiryDate: registryEntry.hackneyExpiryDate.toISOString().split('T')[0],
      operator: registryEntry.hackneyOperator,
      statusFlag: registryEntry.hackneyStatus || 'Active',
    } : null;

    const foundAny = insurance.status === 'found' || license || roadworthiness || hackneyPermit || vehicleInfo;

    const reportData = {
      plateNumber: plate,
      vehicleInfo,
      insurance,
      license,
      roadworthiness,
      hackneyPermit,
      generatedAt: new Date().toISOString(),
      summary: foundAny
        ? niidResult.status === 'found'
          ? 'Vehicle verified via NIID — live insurance data confirmed'
          : 'Vehicle data located in Transport Advisory registry'
        : 'No records found anywhere — verify with seller before purchase',
    };

    const verification = await prisma.vehicleVerification.create({
      data: {
        id: uuid(),
        userId: userId || null,
        plateNumber: plate,
        reportData: reportData as any,
        fee: 0,
        isPaid: true,
      },
    });

    sendSuccess(res, 'Verification complete', {
      verificationId: verification.id,
      report: reportData,
    });
  } catch (error: any) {
    console.error('Verification error:', error?.message || error);
    sendError(res, 'Failed to run verification', 500);
  }
};

export const getVerifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const verifications = await prisma.vehicleVerification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, 'Verifications fetched', verifications);
  } catch (error) {
    sendError(res, 'Failed to fetch verifications', 500);
  }
};

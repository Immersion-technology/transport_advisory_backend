import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { issueMagicLink, sendMagicLinkEmail, consumeMagicLink as consumeToken } from '../services/magicLinkService';
import { quoteForCategoryDocument } from '../services/pricingService';

const signToken = (id: string, email: string, role: string): string =>
  jwt.sign(
    { id, email, role },
    process.env.JWT_SECRET as string,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
  );

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, password, firstName, lastName } = req.body;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      sendError(res, 'Email or phone already registered', 400);
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuid(),
        email,
        phone,
        password: hashed,
        firstName,
        lastName,
      },
    });

    const token = signToken(user.id, user.email, user.role);
    const { password: _, ...userWithoutPassword } = user;

    sendSuccess(res, 'Registration successful', { user: userWithoutPassword, token }, 201);
  } catch (error) {
    console.error('Register error:', error);
    sendError(res, 'Registration failed', 500);
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, 'Invalid email or password', 401);
      return;
    }

    // Users created via the auto-checkout flow have no password yet —
    // they must use a magic link (POST /auth/magic-link/request) to sign in.
    if (!user.password) {
      sendError(res, 'No password set for this account. Use the magic-link sign-in instead.', 401);
      return;
    }

    if (!(await bcrypt.compare(password, user.password))) {
      sendError(res, 'Invalid email or password', 401);
      return;
    }

    if (!user.isActive) {
      sendError(res, 'Account has been deactivated', 403);
      return;
    }

    const token = signToken(user.id, user.email, user.role);
    const { password: _, ...userWithoutPassword } = user;

    sendSuccess(res, 'Login successful', { user: userWithoutPassword, token });
  } catch (error) {
    console.error('Login error:', error);
    sendError(res, 'Login failed', 500);
  }
};

/**
 * POST /api/auth/checkout — public.
 * Used when an unauthenticated visitor submits a service request from the
 * landing page. We create the user (or reuse an existing match), create the
 * vehicle if it's new, draft an Application in PENDING status, and email a
 * magic-link so the user can pick up where they left off.
 *
 * Body shape:
 *   firstName, lastName, email, phone,
 *   vehicle: { plateNumber, make, model, year, stateOfRegistration },
 *   service: { documentType, kind: 'RENEWAL' | 'FRESH', delivery? }
 */
export const checkout = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      firstName, lastName, othernames, email, phone, gender, address,
      vehicle: vehicleInput, service,
    } = req.body;

    const kind = service?.kind === 'FRESH' ? 'FRESH' : 'RENEWAL';

    // Universal requirements
    if (!firstName || !lastName || !email || !phone || !vehicleInput?.plateNumber || !service?.documentType) {
      sendError(res, 'Missing required fields: firstName, lastName, email, phone, vehicle.plateNumber, service.documentType', 400);
      return;
    }
    if (service.documentType === 'CHANGE_OF_OWNERSHIP' && kind !== 'FRESH') {
      sendError(res, 'Change of ownership is only available as a new application.', 400);
      return;
    }
    // Fresh applications must include the vehicle category for pricing,
    // plus the user-supplied vehicle and applicant details.
    if (kind === 'FRESH') {
      const missing: string[] = [];
      if (!vehicleInput.categoryId) missing.push('vehicle.categoryId');
      if (!vehicleInput.make) missing.push('vehicle.make');
      if (!vehicleInput.model) missing.push('vehicle.model');
      if (!vehicleInput.colour) missing.push('vehicle.colour');
      if (!vehicleInput.chassisNumber) missing.push('vehicle.chassisNumber');
      if (!vehicleInput.engineNumber) missing.push('vehicle.engineNumber');
      if (!gender) missing.push('gender');
      if (!address) missing.push('address');
      if (missing.length) {
        sendError(res, `New applications require: ${missing.join(', ')}`, 400);
        return;
      }
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phone).trim();
    const normalizedPlate = String(vehicleInput.plateNumber).trim().toUpperCase();

    // Find or create the user. We match on email OR phone since both are unique.
    let user = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { phone: normalizedPhone }] },
    });

    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          id: uuid(),
          email: normalizedEmail,
          phone: normalizedPhone,
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          othernames: othernames ? String(othernames).trim() : null,
          gender: gender || null,
          address: address ? String(address).trim() : null,
          // Password intentionally left null — user authenticates via magic link
        },
      });
    } else if (kind === 'FRESH') {
      // Top up missing applicant fields on a returning user — never overwrite
      // existing ones (so we don't trash a user's saved profile if they
      // re-submit with stale data).
      const updates: Record<string, any> = {};
      if (!user.othernames && othernames) updates.othernames = String(othernames).trim();
      if (!user.gender && gender) updates.gender = gender;
      if (!user.address && address) updates.address = String(address).trim();
      if (Object.keys(updates).length) {
        user = await prisma.user.update({ where: { id: user.id }, data: updates });
      }
    }

    // Find or create the vehicle on this user's account.
    let vehicle = await prisma.vehicle.findUnique({
      where: { userId_plateNumber: { userId: user.id, plateNumber: normalizedPlate } },
    });

    if (!vehicle) {
      // RENEWAL: only the plate is captured. Vehicle is created unverified;
      // admin populates the rest during verification before payment opens up.
      // FRESH: user supplies everything, so we mark the vehicle verified
      // immediately and pricing can be computed.
      vehicle = await prisma.vehicle.create({
        data: {
          id: uuid(),
          userId: user.id,
          plateNumber: normalizedPlate,
          make: vehicleInput.make || null,
          model: vehicleInput.model || null,
          year: vehicleInput.year ? Number(vehicleInput.year) : null,
          stateOfRegistration: vehicleInput.stateOfRegistration || null,
          colour: vehicleInput.colour || null,
          chassisNumber: vehicleInput.chassisNumber || null,
          engineNumber: vehicleInput.engineNumber || null,
          chassisPhotoUrl: vehicleInput.chassisPhotoUrl || null,
          chassisPhotoPublicId: vehicleInput.chassisPhotoPublicId || null,
          licensePhotoUrl: vehicleInput.licensePhotoUrl || null,
          licensePhotoPublicId: vehicleInput.licensePhotoPublicId || null,
          categoryId: vehicleInput.categoryId || null,
          isVerified: kind === 'FRESH',
          verifiedAt: kind === 'FRESH' ? new Date() : null,
        },
      });
    } else if (kind === 'FRESH') {
      // Top up missing fields on existing vehicle for fresh apps
      const updates: Record<string, any> = {};
      if (!vehicle.make && vehicleInput.make) updates.make = vehicleInput.make;
      if (!vehicle.model && vehicleInput.model) updates.model = vehicleInput.model;
      if (!vehicle.colour && vehicleInput.colour) updates.colour = vehicleInput.colour;
      if (!vehicle.chassisNumber && vehicleInput.chassisNumber) updates.chassisNumber = vehicleInput.chassisNumber;
      if (!vehicle.engineNumber && vehicleInput.engineNumber) updates.engineNumber = vehicleInput.engineNumber;
      if (!vehicle.categoryId && vehicleInput.categoryId) updates.categoryId = vehicleInput.categoryId;
      if (!vehicle.year && vehicleInput.year) updates.year = Number(vehicleInput.year);
      if (vehicleInput.chassisPhotoUrl) {
        updates.chassisPhotoUrl = vehicleInput.chassisPhotoUrl;
        updates.chassisPhotoPublicId = vehicleInput.chassisPhotoPublicId;
      }
      if (vehicleInput.licensePhotoUrl) {
        updates.licensePhotoUrl = vehicleInput.licensePhotoUrl;
        updates.licensePhotoPublicId = vehicleInput.licensePhotoPublicId;
      }
      if (Object.keys(updates).length) {
        vehicle = await prisma.vehicle.update({ where: { id: vehicle.id }, data: updates });
      }
    }

    // Reject duplicate active applications (mirrors createApplication).
    const active = await prisma.application.findFirst({
      where: {
        vehicleId: vehicle.id,
        documentType: service.documentType,
        status: { in: ['PENDING', 'PROCESSING', 'SUBMITTED', 'READY'] },
      },
    });
    if (active) {
      sendError(res, `You already have an active ${service.documentType} application for ${normalizedPlate} (status: ${active.status}).`, 409);
      return;
    }

    // ── Pricing ──────────────────────────────────────────────────────────
    // FRESH: compute total now from the (category, document) pricing matrix
    //        + 15% VAT-inclusive service fee + delivery fee.
    // RENEWAL: total is unknown until admin verifies the vehicle and assigns
    //          a category. We persist the application with totalAmount=0 and
    //          gate `initPayment` on `vehicle.isVerified`.
    const d = service.delivery;
    const deliveryFee = d?.tier === 'SAME_DAY' ? 8000 : d?.tier === 'EXPRESS' ? 4500 : d?.tier === 'STANDARD' ? 3000 : 0;

    let governmentFee = 0;
    let serviceFee = 0;
    let totalAmount = 0;
    let pricingNotes: string | null = null;

    if (kind === 'FRESH' && vehicle.categoryId) {
      try {
        const quote = await quoteForCategoryDocument(vehicle.categoryId, service.documentType);
        governmentFee = quote.basePrice;
        serviceFee = quote.serviceFee;
        totalAmount = quote.total + deliveryFee;
        pricingNotes = quote.notes ?? null;
      } catch (err: any) {
        sendError(res, err.message || 'Pricing not available for this category and document.', 400);
        return;
      }
    }

    const application = await prisma.application.create({
      data: {
        id: uuid(),
        userId: user.id,
        vehicleId: vehicle.id,
        documentType: service.documentType,
        kind,
        governmentFee,
        serviceFee,
        totalAmount,
        notes: pricingNotes,
        ...(d && d.tier && {
          delivery: {
            create: {
              id: uuid(),
              tier: d.tier,
              fee: deliveryFee,
              address: d.address || user.address || '',
              city: d.city || '',
              state: d.state || 'Lagos',
              recipientName: d.recipientName || `${user.firstName} ${user.lastName}`,
              recipientPhone: d.recipientPhone || user.phone,
            },
          },
        }),
        statusHistory: {
          create: {
            id: uuid(),
            status: 'PENDING',
            notes:
              kind === 'RENEWAL'
                ? 'Renewal request created — awaiting admin vehicle verification'
                : isNewUser
                ? 'Application created via auto-checkout (new account)'
                : 'Application created via auto-checkout',
          },
        },
      },
      include: { vehicle: true, delivery: true },
    });

    // Issue + email a magic link. Whether new account or returning user,
    // we send them straight to their dashboard via this token.
    const link = await issueMagicLink({
      userId: user.id,
      purpose: isNewUser ? 'WELCOME' : 'LOGIN',
    });

    try {
      await sendMagicLinkEmail({
        email: user.email,
        firstName: user.firstName,
        token: link.token,
        purpose: isNewUser ? 'WELCOME' : 'LOGIN',
      });
    } catch (emailErr) {
      // Don't fail the checkout if email fails — log and continue. The user
      // can request a fresh link from the login page.
      console.error('Failed to send magic-link email:', emailErr);
    }

    sendSuccess(
      res,
      isNewUser
        ? 'Account created. Check your email for a login link to access your dashboard.'
        : 'Application created. Check your email for a login link.',
      {
        applicationId: application.id,
        isNewUser,
        emailSentTo: user.email,
      },
      201
    );
  } catch (error) {
    console.error('Checkout error:', error);
    sendError(res, 'Failed to process checkout', 500);
  }
};

/**
 * POST /api/auth/magic-link/request — public.
 * Lets a returning user request a fresh login link by email. We never reveal
 * whether the email exists (returns success either way).
 */
export const requestMagicLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) { sendError(res, 'Email is required', 400); return; }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user && user.isActive) {
      const link = await issueMagicLink({ userId: user.id, purpose: 'LOGIN' });
      try {
        await sendMagicLinkEmail({
          email: user.email,
          firstName: user.firstName,
          token: link.token,
          purpose: 'LOGIN',
        });
      } catch (emailErr) {
        console.error('Failed to send magic-link email:', emailErr);
      }
    }

    // Same response whether the email exists or not (avoid account enumeration)
    sendSuccess(res, 'If that email is registered with us, a login link has been sent.');
  } catch (error) {
    console.error('Request magic link error:', error);
    sendError(res, 'Failed to request magic link', 500);
  }
};

/**
 * POST /api/auth/magic-link/consume — public.
 * Exchanges a magic-link token for a JWT.
 */
export const consumeMagicLinkController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    if (!token) { sendError(res, 'Token is required', 400); return; }

    const result = await consumeToken(String(token));
    if (!result.ok) {
      const message =
        result.reason === 'expired' ? 'This login link has expired. Request a new one.' :
        result.reason === 'consumed' ? 'This login link has already been used. Request a new one.' :
        result.reason === 'inactive' ? 'This account is no longer active.' :
        'Invalid login link.';
      sendError(res, message, 401);
      return;
    }

    const jwtToken = signToken(result.user.id, result.user.email, result.user.role);
    const { password: _, ...userWithoutPassword } = result.user;

    sendSuccess(res, 'Signed in', {
      user: userWithoutPassword,
      token: jwtToken,
      isFirstLogin: result.purpose === 'WELCOME',
    });
  } catch (error) {
    console.error('Consume magic link error:', error);
    sendError(res, 'Failed to sign in with magic link', 500);
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, email: true, phone: true, firstName: true, lastName: true,
        role: true, permissions: true, isSuperAdmin: true,
        subscriptionTier: true, subscriberNumber: true,
        isActive: true, emailVerified: true, createdAt: true,
        _count: { select: { vehicles: true } },
      },
    });
    if (!user) { sendError(res, 'User not found', 404); return; }
    sendSuccess(res, 'Profile fetched', user);
  } catch (error) {
    sendError(res, 'Failed to fetch profile', 500);
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, phone } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { firstName, lastName, phone },
      select: {
        id: true, email: true, phone: true, firstName: true, lastName: true,
        role: true, subscriptionTier: true, subscriberNumber: true,
      },
    });
    sendSuccess(res, 'Profile updated', user);
  } catch (error) {
    sendError(res, 'Failed to update profile', 500);
  }
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      sendError(res, 'New password must be at least 8 characters', 400);
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) { sendError(res, 'User not found', 404); return; }

    // Magic-link users may not have a password yet — allow them to set one
    // without supplying a current password (they're already authenticated).
    if (user.password) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
        sendError(res, 'Current password is incorrect', 400);
        return;
      }
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user!.id }, data: { password: hashed } });
    sendSuccess(res, user.password ? 'Password changed successfully' : 'Password set successfully');
  } catch (error) {
    sendError(res, 'Failed to change password', 500);
  }
};

import { Response } from 'express';
import { randomUUID as uuid } from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';
import { sendEmail } from '../services/emailService';

const VALID_PERMISSIONS = [
  'MANAGE_APPLICATIONS',
  'MANAGE_USERS',
  'MANAGE_DELIVERIES',
  'MANAGE_REMINDERS',
  'MANAGE_ADMINS',
];

export const getAllAdmins = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true, email: true, phone: true, firstName: true, lastName: true,
        permissions: true, isSuperAdmin: true, isActive: true, createdAt: true,
      },
      orderBy: [{ isSuperAdmin: 'desc' }, { createdAt: 'asc' }],
    });
    sendSuccess(res, 'Admins fetched', admins);
  } catch (error) {
    sendError(res, 'Failed to fetch admins', 500);
  }
};

export const createAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, phone, firstName, lastName, password, permissions = [] } = req.body;

    if (!email || !phone || !firstName || !lastName || !password) {
      sendError(res, 'All fields are required', 400);
      return;
    }

    const invalidPerms = permissions.filter((p: string) => !VALID_PERMISSIONS.includes(p));
    if (invalidPerms.length) {
      sendError(res, `Invalid permissions: ${invalidPerms.join(', ')}`, 400);
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      sendError(res, 'Email or phone already in use', 400);
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        id: uuid(),
        email,
        phone,
        password: hashed,
        firstName,
        lastName,
        role: 'ADMIN',
        permissions,
        isSuperAdmin: false,
        emailVerified: true,
      },
      select: {
        id: true, email: true, phone: true, firstName: true, lastName: true,
        permissions: true, isSuperAdmin: true, isActive: true, createdAt: true,
      },
    });

    // Notify new admin
    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to Transport Advisory — Admin Access Granted',
        html: `<p>Dear ${firstName},</p>
               <p>You have been granted admin access to the Transport Advisory platform.</p>
               <p><strong>Login email:</strong> ${email}<br>
                  <strong>Temporary password:</strong> ${password}</p>
               <p><strong>Your permissions:</strong></p>
               <ul>${permissions.map((p: string) => `<li>${p.replace('_', ' ').toLowerCase()}</li>`).join('')}</ul>
               <p>Please change your password after your first login. Sign in at <a href="${process.env.FRONTEND_URL}/login">${process.env.FRONTEND_URL}/login</a>.</p>`,
      });
    } catch (_) { /* non-blocking */ }

    sendSuccess(res, 'Admin created successfully', admin, 201);
  } catch (error) {
    console.error('Create admin error:', error);
    sendError(res, 'Failed to create admin', 500);
  }
};

export const updateAdminPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      sendError(res, 'Permissions must be an array', 400);
      return;
    }

    const invalidPerms = permissions.filter((p: string) => !VALID_PERMISSIONS.includes(p));
    if (invalidPerms.length) {
      sendError(res, `Invalid permissions: ${invalidPerms.join(', ')}`, 400);
      return;
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'ADMIN') {
      sendError(res, 'Admin not found', 404);
      return;
    }
    if (target.isSuperAdmin) {
      sendError(res, 'Super admin permissions cannot be modified', 400);
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { permissions },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        permissions: true, isSuperAdmin: true, isActive: true,
      },
    });

    sendSuccess(res, 'Permissions updated', updated);
  } catch (error) {
    sendError(res, 'Failed to update permissions', 500);
  }
};

export const toggleAdminActive = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'ADMIN') {
      sendError(res, 'Admin not found', 404);
      return;
    }
    if (target.isSuperAdmin) {
      sendError(res, 'Super admin cannot be deactivated', 400);
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: !target.isActive },
      select: { id: true, email: true, isActive: true },
    });
    sendSuccess(res, updated.isActive ? 'Admin activated' : 'Admin deactivated', updated);
  } catch (error) {
    sendError(res, 'Failed to toggle admin status', 500);
  }
};

export const deleteAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'ADMIN') {
      sendError(res, 'Admin not found', 404);
      return;
    }
    if (target.isSuperAdmin) {
      sendError(res, 'Super admin cannot be deleted', 400);
      return;
    }

    await prisma.user.delete({ where: { id } });
    sendSuccess(res, 'Admin removed');
  } catch (error) {
    sendError(res, 'Failed to remove admin', 500);
  }
};

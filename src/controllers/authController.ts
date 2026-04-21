import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';

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

    const count = await prisma.user.count();
    const subscriberNumber = count + 1;
    const tier = subscriberNumber <= 50 ? 'FOUNDING_FREE' : 'STANDARD';

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuid(),
        email,
        phone,
        password: hashed,
        firstName,
        lastName,
        subscriptionTier: tier as 'FOUNDING_FREE' | 'STANDARD',
        subscriberNumber,
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
    if (!user || !(await bcrypt.compare(password, user.password))) {
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
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      sendError(res, 'Current password is incorrect', 400);
      return;
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user!.id }, data: { password: hashed } });
    sendSuccess(res, 'Password changed successfully');
  } catch (error) {
    sendError(res, 'Failed to change password', 500);
  }
};

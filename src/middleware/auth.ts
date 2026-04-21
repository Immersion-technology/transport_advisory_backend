import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JwtPayload } from '../types';
import { sendError } from '../utils/response';
import prisma from '../utils/prisma';

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    sendError(res, 'Authentication required', 401);
    return;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    sendError(res, 'Invalid or expired token', 401);
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'ADMIN') {
    sendError(res, 'Admin access required', 403);
    return;
  }
  next();
};

export const requireSuperAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (req.user?.role !== 'ADMIN') {
    sendError(res, 'Admin access required', 403);
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.isSuperAdmin) {
    sendError(res, 'Super admin access required', 403);
    return;
  }
  next();
};

export const requirePermission = (perm: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
      sendError(res, 'Admin access required', 403);
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }
    // Super admin has all permissions
    if (user.isSuperAdmin) { next(); return; }
    if (!user.permissions.includes(perm as any)) {
      sendError(res, `Missing permission: ${perm}`, 403);
      return;
    }
    next();
  };
};

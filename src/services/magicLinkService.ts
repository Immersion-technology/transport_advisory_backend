import { randomBytes, randomUUID as uuid } from 'crypto';
import prisma from '../utils/prisma';
import { sendEmail, buildMagicLinkEmail } from './emailService';

const TOKEN_TTL_MINUTES = 30;

const generateToken = (): string => randomBytes(32).toString('hex');

export interface IssueMagicLinkParams {
  userId: string;
  purpose: 'WELCOME' | 'LOGIN';
  ttlMinutes?: number;
}

export const issueMagicLink = async ({ userId, purpose, ttlMinutes = TOKEN_TTL_MINUTES }: IssueMagicLinkParams) => {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const record = await prisma.magicLinkToken.create({
    data: { id: uuid(), userId, token, purpose, expiresAt },
  });

  return record;
};

export const sendMagicLinkEmail = async (params: {
  email: string;
  firstName: string;
  token: string;
  purpose: 'WELCOME' | 'LOGIN';
  ttlMinutes?: number;
}) => {
  const { email, firstName, token, purpose, ttlMinutes = TOKEN_TTL_MINUTES } = params;
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/auth/magic/${token}`;

  const subject = purpose === 'WELCOME'
    ? 'Welcome to Transport Advisory Services — your account is ready'
    : 'Your Transport Advisory Services login link';

  await sendEmail({
    to: email,
    subject,
    html: buildMagicLinkEmail({ firstName, link, purpose, ttlMinutes }),
  });
};

export const consumeMagicLink = async (token: string) => {
  const record = await prisma.magicLinkToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!record) return { ok: false as const, reason: 'invalid' as const };
  if (record.consumedAt) return { ok: false as const, reason: 'consumed' as const };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: 'expired' as const };
  if (!record.user.isActive) return { ok: false as const, reason: 'inactive' as const };

  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  // First-time consumption verifies the email
  if (!record.user.emailVerified) {
    await prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
    });
  }

  return { ok: true as const, user: record.user, purpose: record.purpose };
};

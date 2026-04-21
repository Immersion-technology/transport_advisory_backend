import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { sendSuccess, sendError } from '../utils/response';

const router = Router();

// One-click confirmation link from email
router.get('/confirm/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const log = await prisma.reminderLog.findUnique({ where: { confirmToken: token } });
    if (!log) {
      sendError(res, 'Invalid confirmation token', 404);
      return;
    }
    if (log.isConfirmed) {
      sendSuccess(res, 'Already confirmed');
      return;
    }
    await prisma.reminderLog.update({
      where: { confirmToken: token },
      data: { isConfirmed: true, confirmedAt: new Date() },
    });
    res.redirect(`${process.env.FRONTEND_URL}/reminder-confirmed`);
  } catch (error) {
    sendError(res, 'Failed to confirm', 500);
  }
});

export default router;

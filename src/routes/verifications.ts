import { Router } from 'express';
import { initiateVerification, getVerifications } from '../controllers/verificationController';
import { authenticate } from '../middleware/auth';
import { verificationLimiter } from '../middleware/rateLimit';

const router = Router();

router.post('/', authenticate, verificationLimiter, initiateVerification);
router.get('/', authenticate, getVerifications);

export default router;

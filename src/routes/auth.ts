import { Router } from 'express';
import {
  register, login, getProfile, updateProfile, changePassword,
  checkout, requestMagicLink, consumeMagicLinkController,
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();

// Brute-force protection on public auth endpoints
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);

// Auto-account-at-checkout flow:
//   POST /auth/checkout            — creates account + application + sends magic link
//   POST /auth/magic-link/request  — re-issues a login link for a returning user
//   POST /auth/magic-link/consume  — exchanges a magic-link token for a JWT
router.post('/checkout', authLimiter, checkout);
router.post('/magic-link/request', authLimiter, requestMagicLink);
router.post('/magic-link/consume', authLimiter, consumeMagicLinkController);

router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/change-password', authenticate, authLimiter, changePassword);

export default router;

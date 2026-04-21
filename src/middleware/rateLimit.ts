import rateLimit from 'express-rate-limit';

// Helper to build a limiter with consistent shape
const build = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7', // sends RateLimit-* headers
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: { success: false, message },
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json(options.message);
    },
  });

/**
 * General limiter for all /api/* traffic.
 * 300 requests per 15-minute window per IP is generous for normal dashboard use
 * but will catch obvious scraping/abuse.
 */
export const globalLimiter = build(
  15 * 60 * 1000,
  300,
  'Too many requests. Please try again in a few minutes.'
);

/**
 * Auth limiter — tighter, because brute-force attempts hit here.
 * 10 login/register attempts per 15 minutes per IP.
 */
export const authLimiter = build(
  15 * 60 * 1000,
  10,
  'Too many authentication attempts. Please try again in 15 minutes.'
);

/**
 * Verification limiter — each call hits NIID scraper (expensive, uses Puppeteer).
 * 10 verifications per hour per IP.
 */
export const verificationLimiter = build(
  60 * 60 * 1000,
  10,
  'Verification limit reached. You can run up to 10 checks per hour.'
);

/**
 * Payment init limiter — prevents Paystack API abuse.
 * 30 payment inits per hour.
 */
export const paymentLimiter = build(
  60 * 60 * 1000,
  30,
  'Too many payment attempts. Please wait before retrying.'
);

/**
 * NIID plate lookup — same scraper, slightly higher quota since users legitimately
 * check insurance when adding a new vehicle.
 */
export const plateLookupLimiter = build(
  60 * 60 * 1000,
  20,
  'Plate lookup quota reached for this hour.'
);

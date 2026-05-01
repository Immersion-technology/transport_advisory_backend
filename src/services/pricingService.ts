import prisma from '../utils/prisma';

/**
 * Service-fee rate stored in SystemConfig under key "service_fee_rate".
 * Default 0.15 (15%, VAT-inclusive). Admin can override from settings.
 */
const SERVICE_FEE_KEY = 'service_fee_rate';
const DEFAULT_SERVICE_FEE_RATE = 0.15;

let cachedRate: { value: number; expiresAt: number } | null = null;

export async function getServiceFeeRate(): Promise<number> {
  // Cache for 60s — admin updates are infrequent and we read this on every checkout.
  if (cachedRate && cachedRate.expiresAt > Date.now()) return cachedRate.value;

  const row = await prisma.systemConfig.findUnique({ where: { key: SERVICE_FEE_KEY } });
  const parsed = row ? Number(row.value) : NaN;
  const value = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_SERVICE_FEE_RATE;
  cachedRate = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function setServiceFeeRate(rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error('Service fee rate must be between 0 and 1');
  }
  await prisma.systemConfig.upsert({
    where: { key: SERVICE_FEE_KEY },
    update: { value: String(rate) },
    create: { key: SERVICE_FEE_KEY, value: String(rate) },
  });
  cachedRate = null;
}

export type DocumentTypeKey =
  | 'MOTOR_INSURANCE'
  | 'VEHICLE_LICENSE'
  | 'ROADWORTHINESS'
  | 'HACKNEY_PERMIT'
  | 'CHANGE_OF_OWNERSHIP';

export interface PricingQuote {
  basePrice: number;
  serviceFee: number;
  serviceFeeRate: number;
  total: number;
  notes?: string | null;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  documentType: DocumentTypeKey;
}

/**
 * Compute the full price quote for a (category, document) pair. Throws if
 * the category isn't configured for this document type — admin must add the
 * pricing row before users can complete a fresh application for it.
 */
export async function quoteForCategoryDocument(
  categoryId: string,
  documentType: DocumentTypeKey,
): Promise<PricingQuote> {
  const [pricing, rate] = await Promise.all([
    prisma.documentPricing.findUnique({
      where: { categoryId_documentType: { categoryId, documentType: documentType as any } },
      include: { category: true },
    }),
    getServiceFeeRate(),
  ]);

  if (!pricing || !pricing.isActive || !pricing.category) {
    throw new Error(
      `No active pricing found for ${documentType} in this vehicle category. Please contact support — admin will configure pricing shortly.`,
    );
  }

  const basePrice = Number(pricing.basePrice);
  // 15% VAT-inclusive service fee. Round to whole naira at the boundary so
  // the user pays a clean figure; total is computed at checkout from these.
  const serviceFee = Math.round(basePrice * rate);
  const total = basePrice + serviceFee;

  return {
    basePrice,
    serviceFee,
    serviceFeeRate: rate,
    total,
    notes: pricing.notes,
    categoryId: pricing.categoryId,
    categoryKey: pricing.category.key,
    categoryLabel: pricing.category.label,
    documentType,
  };
}

/**
 * Returns the pricing matrix grouped by category. Used by the admin pricing
 * page and by the public /start wizard to show estimated totals.
 */
export async function getFullPricingMatrix() {
  const categories = await prisma.vehicleCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      pricing: {
        where: { isActive: true },
      },
    },
  });
  const rate = await getServiceFeeRate();
  return { categories, serviceFeeRate: rate };
}

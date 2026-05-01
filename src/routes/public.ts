import { Router, Request, Response } from 'express';
import { upload } from '../middleware/upload';
import { uploadFile } from '../services/cloudinaryService';
import { sendSuccess, sendError } from '../utils/response';
import { getPublicPricing } from '../controllers/pricingController';

const router = Router();

// Public pricing matrix — used by the /start wizard to show estimates
// before the user has signed in.
router.get('/pricing', getPublicPricing);

/**
 * Public photo upload for the /start wizard. Accepts a single image file
 * (chassis number photo or vehicle license photo) and returns its Cloudinary
 * URL + public ID. Folder is `start/<kind>` so admin can audit later.
 *
 * `kind` query param controls the folder ("chassis" | "license"). Anything
 * else lands in `start/misc`.
 */
router.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;
      if (!file) { sendError(res, 'No file provided', 400); return; }

      const kindRaw = String(req.query.kind || 'misc').toLowerCase();
      const kind = ['chassis', 'license'].includes(kindRaw) ? kindRaw : 'misc';

      const { downloadUrl, publicId } = await uploadFile(
        file.buffer,
        `start/${kind}`,
        'image',
        file.originalname,
      );
      sendSuccess(res, 'Uploaded', { url: downloadUrl, publicId });
    } catch (err) {
      console.error('Public upload error:', err);
      sendError(res, 'Failed to upload', 500);
    }
  },
);

export default router;

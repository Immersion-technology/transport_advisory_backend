import { Router } from 'express';
import {
  createApplication, uploadApplicationDocs,
  initPayment, verifyPayment, getApplications, getApplication,
} from '../controllers/applicationController';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { paymentLimiter } from '../middleware/rateLimit';

const router = Router();

router.use(authenticate);

router.get('/', getApplications);
router.post('/', createApplication);
router.get('/:id', getApplication);
router.post('/:applicationId/documents', upload.array('files', 10), uploadApplicationDocs);
router.post('/:applicationId/pay', paymentLimiter, initPayment);
router.get('/verify/:reference', verifyPayment);

export default router;

import { Router } from 'express';
import {
  addVehicle, getVehicles, getVehicle, updateVehicle,
  deleteVehicle, lookupPlate, upsertDocument,
} from '../controllers/vehicleController';
import { authenticate } from '../middleware/auth';
import { plateLookupLimiter } from '../middleware/rateLimit';

const router = Router();

router.use(authenticate);

router.get('/', getVehicles);
router.post('/', addVehicle);
router.get('/lookup/:plateNumber', plateLookupLimiter, lookupPlate);
router.get('/:id', getVehicle);
router.put('/:id', updateVehicle);
router.delete('/:id', deleteVehicle);
router.post('/documents', upsertDocument);

export default router;

import { Router } from 'express';
import {
  getDashboardStats, getAllApplications, getApplicationDetail, updateApplicationStatus,
  uploadCompletedDocument, getUnconfirmedReminders, getAllUsers, updateUserStatus,
  getAllDeliveries, updateDeliveryStatus,
} from '../controllers/adminController';
import {
  getAllAdmins, createAdmin, updateAdminPermissions, toggleAdminActive, deleteAdmin,
} from '../controllers/adminStaffController';
import {
  getRegistryEntries, upsertRegistryEntry, seedFromUserVehicles, deleteRegistryEntry,
} from '../controllers/plateRegistryController';
import {
  getAdminPricing, upsertPricing, createCategory, updateCategory,
  updateServiceFeeRate, verifyVehicle, listUnverifiedVehicles,
} from '../controllers/pricingController';
import { authenticate, requireAdmin, requireSuperAdmin, requirePermission } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.use(authenticate, requireAdmin);

// Stats — all admins can see
router.get('/stats', getDashboardStats);

// Users — needs MANAGE_USERS
router.get('/users', requirePermission('MANAGE_USERS'), getAllUsers);
router.put('/users/:id/status', requirePermission('MANAGE_USERS'), updateUserStatus);

// Applications — needs MANAGE_APPLICATIONS
router.get('/applications', requirePermission('MANAGE_APPLICATIONS'), getAllApplications);
router.get('/applications/:id', requirePermission('MANAGE_APPLICATIONS'), getApplicationDetail);
router.put('/applications/:id/status', requirePermission('MANAGE_APPLICATIONS'), updateApplicationStatus);
router.post('/applications/:id/document', requirePermission('MANAGE_APPLICATIONS'), upload.single('file'), uploadCompletedDocument);

// Reminders — needs MANAGE_REMINDERS
router.get('/reminders/unconfirmed', requirePermission('MANAGE_REMINDERS'), getUnconfirmedReminders);

// Deliveries — needs MANAGE_DELIVERIES
router.get('/deliveries', requirePermission('MANAGE_DELIVERIES'), getAllDeliveries);
router.put('/deliveries/:id/status', requirePermission('MANAGE_DELIVERIES'), updateDeliveryStatus);

// Plate registry — MANAGE_APPLICATIONS gates access (since it's verification data)
router.get('/registry', requirePermission('MANAGE_APPLICATIONS'), getRegistryEntries);
router.post('/registry', requirePermission('MANAGE_APPLICATIONS'), upsertRegistryEntry);
router.post('/registry/seed-from-user/:userId', requirePermission('MANAGE_APPLICATIONS'), seedFromUserVehicles);
router.delete('/registry/:id', requirePermission('MANAGE_APPLICATIONS'), deleteRegistryEntry);

// Pricing matrix + service-fee rate — needs MANAGE_APPLICATIONS to view/edit
router.get('/pricing', requirePermission('MANAGE_APPLICATIONS'), getAdminPricing);
router.put('/pricing', requirePermission('MANAGE_APPLICATIONS'), upsertPricing);
router.post('/pricing/categories', requirePermission('MANAGE_APPLICATIONS'), createCategory);
router.put('/pricing/categories/:id', requirePermission('MANAGE_APPLICATIONS'), updateCategory);
router.put('/pricing/service-fee-rate', requireSuperAdmin, updateServiceFeeRate);

// Vehicle verification queue — admin populates fields from check websites
// before user can complete renewal payment.
router.get('/vehicles/unverified', requirePermission('MANAGE_APPLICATIONS'), listUnverifiedVehicles);
router.put('/vehicles/:id/verify', requirePermission('MANAGE_APPLICATIONS'), verifyVehicle);

// Admin staff management — super admin only
router.get('/staff', requireSuperAdmin, getAllAdmins);
router.post('/staff', requireSuperAdmin, createAdmin);
router.put('/staff/:id/permissions', requireSuperAdmin, updateAdminPermissions);
router.put('/staff/:id/toggle', requireSuperAdmin, toggleAdminActive);
router.delete('/staff/:id', requireSuperAdmin, deleteAdmin);

export default router;

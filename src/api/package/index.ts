import { Router } from 'express';
import {
  createPackage,
  getPackages,
  getPackageById,
  updatePackage,
  deletePackage,
  getPackageSettings,
  updatePackageSettings,
  createCustomPackage,
} from './controller';
import { authenticate, hasAuth, optionalAuthenticate } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Package settings routes (Public get, Admin/Super Admin update)
router.get('/settings', getPackageSettings);
router.put('/settings', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updatePackageSettings);

// Custom package route for customers
router.post('/custom', authenticate, createCustomPackage);

// Public routes (with optional customer auth for customer-specific packages)
router.get('/', optionalAuthenticate, getPackages);
router.get('/:id', getPackageById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createPackage);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updatePackage);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deletePackage);

export default router;

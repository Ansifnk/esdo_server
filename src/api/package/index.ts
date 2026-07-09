import { Router } from 'express';
import {
  createPackage,
  getPackages,
  getPackageById,
  updatePackage,
  deletePackage,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes
router.get('/', getPackages);
router.get('/:id', getPackageById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createPackage);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updatePackage);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deletePackage);

export default router;

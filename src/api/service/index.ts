import { Router } from 'express';
import {
  createService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes for customer/visitor access
router.get('/', getServices);
router.get('/:id', getServiceById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createService);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateService);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deleteService);

export default router;

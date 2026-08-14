import { Router } from 'express';
import {
  createStaff,
  getStaffs,
  getStaffById,
  updateStaff,
  deleteStaff,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes for customer/visitor access
router.get('/', getStaffs);
router.get('/:id', getStaffById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createStaff);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateStaff);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deleteStaff);

export default router;

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

// Apply authentication middleware to all staff routes
router.use(authenticate);

router.post('/', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createStaff);
router.get('/', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), getStaffs);
router.get('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), getStaffById);
router.put('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateStaff);
router.delete('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deleteStaff);

export default router;

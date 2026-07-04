import { Router } from 'express';
import {
  createAdmin,
  getAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Apply authentication middleware to all admin routes
router.use(authenticate);

router.post('/', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), createAdmin);
router.get('/', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), getAdmins);
router.get('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), getAdminById);
router.put('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateAdmin);
router.delete('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), deleteAdmin);

export default router;

import { Router } from 'express';
import {
  createStaffLanguage,
  getStaffLanguages,
  getStaffLanguageById,
  updateStaffLanguage,
  deleteStaffLanguage,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Query routes
router.get('/', getStaffLanguages);
router.get('/:id', getStaffLanguageById);

// Protected mutation routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createStaffLanguage);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateStaffLanguage);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deleteStaffLanguage);

export default router;

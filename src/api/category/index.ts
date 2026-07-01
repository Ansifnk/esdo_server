import { Router } from 'express';
import {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes
router.get('/', getCategories);
router.get('/:id', getCategoryById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createCategory);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateCategory);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deleteCategory);

export default router;

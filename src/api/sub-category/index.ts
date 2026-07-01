import { Router } from 'express';
import {
  createSubCategory,
  getSubCategories,
  getSubCategoryById,
  updateSubCategory,
  deleteSubCategory,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes
router.get('/', getSubCategories);
router.get('/:id', getSubCategoryById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN] }), createSubCategory);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN] }), updateSubCategory);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN] }), deleteSubCategory);

export default router;

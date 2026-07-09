import { Router } from 'express';
import {
  createOffer,
  getOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes
router.get('/', getOffers);
router.get('/:id', getOfferById);

// Protected routes (Admin / Super Admin only)
router.post('/', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), createOffer);
router.put('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), updateOffer);
router.delete('/:id', authenticate, hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), deleteOffer);

export default router;

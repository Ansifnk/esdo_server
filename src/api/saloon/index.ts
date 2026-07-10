import { Router } from 'express';
import {
  createSaloon,
  getSaloons,
  getSaloonById,
  updateSaloon,
  deleteSaloon,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Public routes
router.get('/', getSaloons);
router.get('/:id', getSaloonById);

// Apply authentication middleware to other saloon routes
router.use(authenticate);

router.post('/', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), createSaloon);
router.put('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), updateSaloon);
router.delete('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), deleteSaloon);

export default router;

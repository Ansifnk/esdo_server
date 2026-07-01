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

// Apply authentication middleware to all saloon routes
router.use(authenticate);

router.post('/', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), createSaloon);
router.get('/', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN, Role.CUSTOMER] }), getSaloons);
router.get('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN, Role.CUSTOMER] }), getSaloonById);
router.put('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), updateSaloon);
router.delete('/:id', hasAuth({ anyRole: [Role.SUPER_ADMIN] }), deleteSaloon);

export default router;

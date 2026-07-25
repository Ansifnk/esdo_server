import { Router } from 'express';
import {
  getAttendanceRecords,
  markAttendance,
  bulkMarkAttendance,
  getAttendanceSummary,
} from './controller';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

// Apply authentication middleware to all attendance routes
router.use(authenticate);

router.get('/', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), getAttendanceRecords);
router.post('/mark', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), markAttendance);
router.post('/bulk-mark', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), bulkMarkAttendance);
router.get('/summary', hasAuth({ anyRole: [Role.SUPER_ADMIN, Role.ADMIN] }), getAttendanceSummary);

export default router;

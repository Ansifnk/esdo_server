import { Router } from 'express';
import {
  getBookings,
  getBookingById,
  getCustomerBookings,
  getCustomerBookingById,
  getAdminBookings,
  getAdminBookingById,
  updateBookingStatus,
  createAdminBooking,
} from './bookingController';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';

const router = Router();

router.get('/', authenticate, getBookings);
router.get('/admin/all', authenticate, hasAuth({ anyRole: [Role.ADMIN, Role.SUPER_ADMIN] }), getAdminBookings);
router.post('/admin', authenticate, hasAuth({ anyRole: [Role.ADMIN, Role.SUPER_ADMIN] }), createAdminBooking);
router.get('/:id', authenticate, getBookingById);
router.put('/:id/status', authenticate, hasAuth({ anyRole: [Role.ADMIN, Role.SUPER_ADMIN] }), updateBookingStatus);

export default router;



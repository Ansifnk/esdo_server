import { Router } from 'express';
import {
  getMemberships,
  createMembership,
  getMembershipById,
  updateMembership,
  deleteMembership,
  getCustomerMemberships,
  getMyMembership,
} from './membershipController';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Customer route
router.get('/my-membership', authenticate, getMyMembership);

// Admin routes
router.get('/', authenticate, getMemberships);
router.post('/', authenticate, createMembership);
router.get('/customer/:customerId', authenticate, getCustomerMemberships);
router.get('/:id', authenticate, getMembershipById);
router.patch('/:id', authenticate, updateMembership);
router.delete('/:id', authenticate, deleteMembership);

export default router;

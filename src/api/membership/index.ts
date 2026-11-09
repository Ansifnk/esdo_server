import { Router } from 'express';
import {
  getMemberships,
  createMembership,
  getMembershipById,
  updateMembership,
  deleteMembership,
  getCustomerMemberships,
  getMyMembership,
  createMembershipOrder,
  verifyAndActivateMembership,
} from './membershipController';
import {
  getPublicPlans,
  getAdminPlans,
  createPlan,
  updatePlan,
  togglePlanActive,
  deletePlan,
} from './membershipPlanController';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Public route: Available active membership plans
router.get('/plans', getPublicPlans);

// Customer routes
router.get('/my-membership', authenticate, getMyMembership);
router.post('/purchase-order', authenticate, createMembershipOrder);
router.post('/verify-and-activate', authenticate, verifyAndActivateMembership);

// Admin routes: Membership Plans management
router.get('/admin/plans', authenticate, getAdminPlans);
router.post('/admin/plans', authenticate, createPlan);
router.patch('/admin/plans/:id', authenticate, updatePlan);
router.patch('/admin/plans/:id/toggle', authenticate, togglePlanActive);
router.delete('/admin/plans/:id', authenticate, deletePlan);

// Admin routes: Issued customer memberships
router.get('/', authenticate, getMemberships);
router.post('/', authenticate, createMembership);
router.get('/customer/:customerId', authenticate, getCustomerMemberships);
router.get('/:id', authenticate, getMembershipById);
router.patch('/:id', authenticate, updateMembership);
router.delete('/:id', authenticate, deleteMembership);

export default router;

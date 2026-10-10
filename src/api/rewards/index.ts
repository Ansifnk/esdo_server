import { Router } from 'express';
import { authenticate, hasAuth } from '../../middlewares/auth';
import { Role } from '../../generated/prisma/enums';
import {
  getMyReferralProfile,
  applyReferralCode,
  validateReferralCode,
  getMyRewardSummary,
  getMyRewardHistory,
} from './customerRewardsController';
import {
  getAdminRewardSettings,
  updateAdminRewardSettings,
  getAdminReferralSlabs,
  upsertAdminReferralSlab,
  deleteAdminReferralSlab,
  getAdminReferrals,
  getAdminRewardLedger,
  adjustCustomerCoins,
  triggerExpiryRun,
} from './rewardsAdminController';

const router = Router();

// ================= CUSTOMER ROUTES =================
router.get('/my-referral', authenticate, getMyReferralProfile);
router.post('/apply-referral', authenticate, applyReferralCode);
router.post('/validate-referral', validateReferralCode);
router.get('/summary', authenticate, getMyRewardSummary);
router.get('/history', authenticate, getMyRewardHistory);

// ================= ADMIN ROUTES =================
const adminAuth = [authenticate, hasAuth({ anyRole: [Role.ADMIN, Role.SUPER_ADMIN] })];

router.get('/admin/settings', ...adminAuth, getAdminRewardSettings);
router.put('/admin/settings', ...adminAuth, updateAdminRewardSettings);

router.get('/admin/slabs', ...adminAuth, getAdminReferralSlabs);
router.post('/admin/slabs', ...adminAuth, upsertAdminReferralSlab);
router.delete('/admin/slabs/:id', ...adminAuth, deleteAdminReferralSlab);

router.get('/admin/referrals', ...adminAuth, getAdminReferrals);
router.get('/admin/ledger', ...adminAuth, getAdminRewardLedger);
router.post('/admin/adjust', ...adminAuth, adjustCustomerCoins);
router.post('/admin/trigger-expiry', ...adminAuth, triggerExpiryRun);

export default router;

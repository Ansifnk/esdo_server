import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { referralService } from './referralService';
import { rewardSettingService } from './rewardSettingService';
import { RewardTxStatus, RewardTxType, ReferralStatus } from '../../generated/prisma/enums';

/**
 * GET /api/rewards/my-referral
 * Get authenticated customer's referral profile, share links, and milestone roadmap
 */
export const getMyReferralProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) throw new AppError('Authentication required', 401);

    const profile = await referralService.getCustomerReferralProfile(customerId);
    res.json(new AppResponse('Referral profile retrieved successfully', profile));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve referral profile', {}, statusCode));
  }
};

/**
 * POST /api/rewards/apply-referral
 * Apply a friend's referral code
 */
export const applyReferralCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) throw new AppError('Authentication required', 401);

    const { referralCode } = req.body;
    if (!referralCode) throw new AppError('Referral code is required', 400);

    const referral = await referralService.applyReferralCode(customerId, referralCode);
    res.json(new AppResponse('Referral code applied successfully!', { referral }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to apply referral code', {}, statusCode));
  }
};

/**
 * POST /api/rewards/validate-referral
 * Validate a referral code for checkout welcome discount
 */
export const validateReferralCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    const { referralCode } = req.body;
    if (!referralCode) throw new AppError('Referral code is required', 400);

    const result = await referralService.validateReferralCodeForWelcomeDiscount(
      customerId || '',
      referralCode
    );
    res.json(new AppResponse('Referral code is valid', result));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Invalid referral code', {}, statusCode));
  }
};

/**
 * GET /api/rewards/summary
 * Get authenticated customer's coins balance, nearest expiry date, and program parameters
 */
export const getMyRewardSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) throw new AppError('Authentication required', 401);

    let [customer, settings, nearestExpiryBatch] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, points: true, referralCode: true },
      }),
      rewardSettingService.getSettings(),
      prisma.rewardTransaction.findFirst({
        where: {
          customerId,
          status: RewardTxStatus.ACTIVE,
          remainingCoins: { gt: 0 },
          expiresAt: { gt: new Date() },
        },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    let referralCode = customer?.referralCode;
    if (!referralCode && customer) {
      referralCode = await referralService.ensureCustomerReferralCode(customer);
    }

    const [activeBatches, lifetimeEarnedSpend, lifetimeEarnedReferral, totalReferrals, completedReferrals] = await Promise.all([
      prisma.rewardTransaction.findMany({
        where: {
          customerId,
          status: RewardTxStatus.ACTIVE,
          remainingCoins: { gt: 0 },
        },
        select: {
          type: true,
          remainingCoins: true,
        },
      }),
      prisma.rewardTransaction.aggregate({
        where: { customerId, type: RewardTxType.SPEND_EARN, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      prisma.rewardTransaction.aggregate({
        where: { customerId, type: RewardTxType.REFERRAL_EARN, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      prisma.referral.count({ where: { referrerId: customerId } }),
      prisma.referral.count({ where: { referrerId: customerId, status: 'QUALIFIED' as any } }),
    ]);

    let rewardPoints = 0;
    let referralPoints = 0;
    let otherPoints = 0;
    for (const b of activeBatches) {
      if (b.type === RewardTxType.SPEND_EARN) {
        rewardPoints += b.remainingCoins;
      } else if (b.type === RewardTxType.REFERRAL_EARN) {
        referralPoints += b.remainingCoins;
      } else {
        otherPoints += b.remainingCoins;
      }
    }

    const totalBalance = customer?.points || 0;
    let reconciledReward = rewardPoints;
    let reconciledReferral = referralPoints;
    const batchTotal = rewardPoints + referralPoints + otherPoints;
    if (batchTotal < totalBalance) {
      reconciledReward += (totalBalance - batchTotal);
    }

    res.json(
      new AppResponse('Reward summary retrieved', {
        coinBalance: totalBalance,
        rewardPoints: reconciledReward,
        referralPoints: reconciledReferral,
        lifetimeRewardPoints: lifetimeEarnedSpend._sum.amount || 0,
        lifetimeReferralPoints: lifetimeEarnedReferral._sum.amount || 0,
        totalReferrals,
        completedReferrals,
        referralCode: referralCode || '',
        nearestExpiryDate: nearestExpiryBatch?.expiresAt || null,
        nearestExpiryCoins: nearestExpiryBatch?.remainingCoins || 0,
        settings: {
          isSpendRewardEnabled: settings.isSpendRewardEnabled,
          spendAmountPerUnit: settings.spendAmountPerUnit,
          coinsEarnedPerUnit: settings.coinsEarnedPerUnit,
          coinRedemptionValue: settings.coinRedemptionValue,
          minRedemptionCoins: settings.minRedemptionCoins,
          maxRedemptionPercentage: settings.maxRedemptionPercentage,
          allowCombineWithCoupon: settings.allowCombineWithCoupon,
          spendCoinExpiryMonths: settings.spendCoinExpiryMonths,
          referredUserDiscountAmount: settings.referredUserDiscountAmount,
        },
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve reward summary', {}, statusCode));
  }
};

/**
 * GET /api/rewards/history
 * Get customer's paginated coin ledger transactions
 */
export const getMyRewardHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) throw new AppError('Authentication required', 401);

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string) || 15));
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.rewardTransaction.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.rewardTransaction.count({ where: { customerId } }),
    ]);

    res.json(
      new AppResponse('Transaction history retrieved', {
        transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve transaction history', {}, statusCode));
  }
};

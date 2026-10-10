import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { rewardSettingService } from './rewardSettingService';
import { processExpiredCoins } from './cronExpiry';
import { RewardTxType, RewardTxStatus } from '../../generated/prisma/enums';

/**
 * GET /api/rewards/admin/settings
 */
export const getAdminRewardSettings = async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await rewardSettingService.getSettings();
    res.json(new AppResponse('Reward settings retrieved', { settings }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve settings', {}, statusCode));
  }
};

/**
 * PUT /api/rewards/admin/settings
 */
export const updateAdminRewardSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const updated = await rewardSettingService.updateSettings(req.body);
    res.json(new AppResponse('Reward settings updated successfully', { settings: updated }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to update settings', {}, statusCode));
  }
};

/**
 * GET /api/rewards/admin/slabs
 */
export const getAdminReferralSlabs = async (_req: Request, res: Response): Promise<void> => {
  try {
    const slabs = await rewardSettingService.getReferralSlabs();
    res.json(new AppResponse('Referral slabs retrieved', { slabs }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve slabs', {}, statusCode));
  }
};

/**
 * POST /api/rewards/admin/slabs
 */
export const upsertAdminReferralSlab = async (req: Request, res: Response): Promise<void> => {
  try {
    const slab = await rewardSettingService.upsertReferralSlab(req.body);
    res.json(new AppResponse('Referral slab saved successfully', { slab }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to save slab', {}, statusCode));
  }
};

/**
 * DELETE /api/rewards/admin/slabs/:id
 */
export const deleteAdminReferralSlab = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    await rewardSettingService.deleteReferralSlab(id);
    res.json(new AppResponse('Referral slab deleted successfully'));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to delete slab', {}, statusCode));
  }
};

/**
 * GET /api/rewards/admin/referrals
 * List all referrals with pagination and filters
 */
export const getAdminReferrals = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    const status = req.query.status as string;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [referrals, total] = await Promise.all([
      prisma.referral.findMany({
        where,
        include: {
          referrer: { select: { id: true, name: true, phone: true, email: true } },
          referredCustomer: { select: { id: true, name: true, phone: true, email: true } },
          qualifyingBooking: { select: { id: true, bookingNumber: true, totalAmount: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.referral.count({ where }),
    ]);

    res.json(
      new AppResponse('Referrals retrieved', {
        referrals,
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
    res.json(new AppResponse(error.message || 'Failed to retrieve referrals', {}, statusCode));
  }
};

/**
 * GET /api/rewards/admin/ledger
 * List all coin transactions with pagination and customer details
 */
export const getAdminRewardLedger = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    const customerId = req.query.customerId as string;
    const type = req.query.type as any;

    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      prisma.rewardTransaction.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, points: true } },
          booking: { select: { id: true, bookingNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.rewardTransaction.count({ where }),
    ]);

    res.json(
      new AppResponse('Ledger transactions retrieved', {
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
    res.json(new AppResponse(error.message || 'Failed to retrieve ledger', {}, statusCode));
  }
};

/**
 * POST /api/rewards/admin/adjust
 * Manual credit or debit coin adjustment for a customer by admin
 */
export const adjustCustomerCoins = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, amount, notes } = req.body;
    if (!customerId || typeof amount !== 'number' || amount === 0) {
      throw new AppError('customerId and non-zero amount number are required', 400);
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new AppError('Customer not found', 404);

    const balanceBefore = customer.points;
    const balanceAfter = Math.max(0, balanceBefore + amount);

    const settings = await rewardSettingService.getSettings();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + settings.spendCoinExpiryMonths);

    const tx = await prisma.rewardTransaction.create({
      data: {
        customerId,
        type: RewardTxType.ADMIN_ADJUSTMENT,
        amount,
        balanceBefore,
        balanceAfter,
        remainingCoins: amount > 0 ? amount : 0,
        expiresAt: amount > 0 ? expiresAt : null,
        status: amount > 0 ? RewardTxStatus.ACTIVE : RewardTxStatus.FULLY_CONSUMED,
        notes: notes || 'Admin adjustment',
      },
    });

    await prisma.customer.update({
      where: { id: customerId },
      data: { points: balanceAfter },
    });

    res.json(
      new AppResponse('Coins adjusted successfully', {
        transaction: tx,
        newBalance: balanceAfter,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to adjust coins', {}, statusCode));
  }
};

/**
 * POST /api/rewards/admin/trigger-expiry
 * Manually trigger expiration of overdue coins
 */
export const triggerExpiryRun = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await processExpiredCoins();
    res.json(new AppResponse('Expiry process completed', result));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Expiry process failed', {}, statusCode));
  }
};

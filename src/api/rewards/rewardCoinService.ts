import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';
import { RewardTxType, RewardTxStatus } from '../../generated/prisma/enums';
import { rewardSettingService } from './rewardSettingService';

export const rewardCoinService = {
  /**
   * Calculate coins earned on an eligible order amount
   * Rule: Every spendAmountPerUnit (e.g. ₹100) earns coinsEarnedPerUnit (e.g. 1 coin)
   */
  async calculateCoinsEarned(subtotal: number): Promise<number> {
    const settings = await rewardSettingService.getSettings();
    if (!settings.isSpendRewardEnabled) return 0;
    if (subtotal <= 0 || settings.spendAmountPerUnit <= 0) return 0;

    const units = Math.floor(subtotal / settings.spendAmountPerUnit);
    return Math.max(0, units * settings.coinsEarnedPerUnit);
  },

  /**
   * Validate coins redemption constraints
   */
  async validateRedemption(params: {
    customerPoints: number;
    subtotal: number;
    pointsToUse: number;
    hasCoupon?: boolean;
  }): Promise<{
    allowedPoints: number;
    discountAmount: number;
  }> {
    const { customerPoints, subtotal, pointsToUse, hasCoupon } = params;
    if (pointsToUse <= 0) {
      return { allowedPoints: 0, discountAmount: 0 };
    }

    const settings = await rewardSettingService.getSettings();

    if (!settings.isSpendRewardEnabled) {
      throw new AppError('Reward coins program is currently disabled', 400);
    }

    // Coupon combination check
    if (hasCoupon && !settings.allowCombineWithCoupon) {
      throw new AppError('Reward coins cannot be combined with coupon codes on this order', 400);
    }

    // Minimum balance requirement to redeem
    if (customerPoints < settings.minRedemptionCoins) {
      throw new AppError(
        `Minimum balance of ${settings.minRedemptionCoins} coins is required to redeem. Current balance: ${customerPoints} coins.`,
        400
      );
    }

    // Maximum redemption per order cap (% of subtotal)
    const maxRedeemableCash = (subtotal * settings.maxRedemptionPercentage) / 100;
    const maxRedeemableCoins = Math.floor(maxRedeemableCash / settings.coinRedemptionValue);

    if (pointsToUse > customerPoints) {
      throw new AppError(`Cannot use more coins than your balance (${customerPoints} coins)`, 400);
    }

    if (pointsToUse > maxRedeemableCoins) {
      throw new AppError(
        `Maximum ${settings.maxRedemptionPercentage}% of order value (max ${maxRedeemableCoins} coins) can be redeemed on this order`,
        400
      );
    }

    const discountAmount = pointsToUse * settings.coinRedemptionValue;
    return {
      allowedPoints: pointsToUse,
      discountAmount,
    };
  },

  /**
   * Deduct coins from customer using FIFO (First-In-First-Out) batch consumption
   */
  async deductCoinsFIFO(
    customerId: string,
    coinsToDeduct: number,
    bookingId: string | null = null,
    externalTx?: any
  ) {
    if (coinsToDeduct <= 0) return;

    const client = externalTx || prisma;

    const customer = await client.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new AppError('Customer not found', 404);

    if (customer.points < coinsToDeduct) {
      throw new AppError('Insufficient coins balance', 400);
    }

    // Fetch active credit batches sorted by createdAt ASC (FIFO)
    const activeBatches = await client.rewardTransaction.findMany({
      where: {
        customerId,
        remainingCoins: { gt: 0 },
        status: RewardTxStatus.ACTIVE,
        type: { in: [RewardTxType.SPEND_EARN, RewardTxType.REFERRAL_EARN, RewardTxType.ADMIN_ADJUSTMENT] },
      },
      orderBy: { createdAt: 'asc' },
    });

    let remainingToDeduct = coinsToDeduct;

    for (const batch of activeBatches) {
      if (remainingToDeduct <= 0) break;

      const deductionFromBatch = Math.min(batch.remainingCoins, remainingToDeduct);
      const newRemaining = batch.remainingCoins - deductionFromBatch;
      const newStatus = newRemaining === 0 ? RewardTxStatus.FULLY_CONSUMED : RewardTxStatus.ACTIVE;

      await client.rewardTransaction.update({
        where: { id: batch.id },
        data: {
          remainingCoins: newRemaining,
          status: newStatus,
        },
      });

      remainingToDeduct -= deductionFromBatch;
    }

    const balanceBefore = customer.points;
    const balanceAfter = Math.max(0, balanceBefore - coinsToDeduct);

    // Record redemption debit transaction
    await client.rewardTransaction.create({
      data: {
        customerId,
        type: RewardTxType.REDEMPTION,
        amount: -coinsToDeduct,
        balanceBefore,
        balanceAfter,
        remainingCoins: 0,
        status: RewardTxStatus.FULLY_CONSUMED,
        bookingId,
        notes: `Redeemed ${coinsToDeduct} coins on order`,
      },
    });

    // Update customer points
    await client.customer.update({
      where: { id: customerId },
      data: { points: balanceAfter },
    });
  },

  /**
   * Credit coins to customer with dynamic expiration
   */
  async creditCoins(params: {
    customerId: string;
    amount: number;
    type: RewardTxType;
    bookingId?: string | null;
    referralId?: string | null;
    notes?: string;
    externalTx?: any;
  }) {
    const { customerId, amount, type, bookingId = null, referralId = null, notes = '', externalTx } = params;
    if (amount <= 0) return;

    const client = externalTx || prisma;
    const settings = await rewardSettingService.getSettings();

    // Determine expiry duration in months based on transaction type
    const expiryMonths =
      type === RewardTxType.REFERRAL_EARN
        ? settings.referralCoinExpiryMonths
        : settings.spendCoinExpiryMonths;

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (expiryMonths || 12));

    const customer = await client.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new AppError('Customer not found', 404);

    const balanceBefore = customer.points;
    const balanceAfter = balanceBefore + amount;

    await client.rewardTransaction.create({
      data: {
        customerId,
        type,
        amount,
        balanceBefore,
        balanceAfter,
        remainingCoins: amount,
        expiresAt,
        status: RewardTxStatus.ACTIVE,
        bookingId,
        referralId,
        notes: notes || `Credited ${amount} coins`,
      },
    });

    await client.customer.update({
      where: { id: customerId },
      data: { points: balanceAfter },
    });
  },

  /**
   * Reverse coins if an order is cancelled or refunded
   */
  async reverseOrderCoins(bookingId: string, externalTx?: any) {
    const client = externalTx || prisma;

    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true },
    });
    if (!booking) return;

    // 1. If coins were earned on this booking, reverse them
    if (booking.pointsEarned > 0) {
      const earnedTx = await client.rewardTransaction.findFirst({
        where: {
          bookingId,
          type: RewardTxType.SPEND_EARN,
        },
      });

      if (earnedTx && earnedTx.status !== RewardTxStatus.REVERSED) {
        const customer = await client.customer.findUnique({ where: { id: booking.customerId } });
        if (customer) {
          const balanceBefore = customer.points;
          const balanceAfter = Math.max(0, balanceBefore - booking.pointsEarned);

          await client.rewardTransaction.create({
            data: {
              customerId: booking.customerId,
              type: RewardTxType.REFUND_REVERSAL,
              amount: -booking.pointsEarned,
              balanceBefore,
              balanceAfter,
              remainingCoins: 0,
              status: RewardTxStatus.REVERSED,
              bookingId,
              notes: `Reversed ${booking.pointsEarned} earned coins due to cancellation/refund`,
            },
          });

          await client.rewardTransaction.update({
            where: { id: earnedTx.id },
            data: { status: RewardTxStatus.REVERSED, remainingCoins: 0 },
          });

          await client.customer.update({
            where: { id: booking.customerId },
            data: { points: balanceAfter },
          });
        }
      }
    }

    // 2. If points were spent/redeemed on this booking, refund them back to customer
    if (booking.pointsUsed > 0) {
      const customer = await client.customer.findUnique({ where: { id: booking.customerId } });
      if (customer) {
        const balanceBefore = customer.points;
        const balanceAfter = balanceBefore + booking.pointsUsed;

        const settings = await rewardSettingService.getSettings();
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + settings.spendCoinExpiryMonths);

        await client.rewardTransaction.create({
          data: {
            customerId: booking.customerId,
            type: RewardTxType.REFUND_REVERSAL,
            amount: booking.pointsUsed,
            balanceBefore,
            balanceAfter,
            remainingCoins: booking.pointsUsed,
            expiresAt,
            status: RewardTxStatus.ACTIVE,
            bookingId,
            notes: `Refunded ${booking.pointsUsed} redeemed coins back to account`,
          },
        });

        await client.customer.update({
          where: { id: booking.customerId },
          data: { points: balanceAfter },
        });
      }
    }
  },
};

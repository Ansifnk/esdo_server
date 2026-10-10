import { prisma } from '../../lib/prisma';
import { RewardTxType, RewardTxStatus } from '../../generated/prisma/enums';

/**
 * Process overdue reward coin batches and write EXPIRY ledger records
 */
export async function processExpiredCoins(): Promise<{ expiredBatches: number; totalCoinsExpired: number }> {
  const now = new Date();

  // Find all active credit batches that have remaining unspent coins and have expired
  const expiredBatches = await prisma.rewardTransaction.findMany({
    where: {
      status: RewardTxStatus.ACTIVE,
      remainingCoins: { gt: 0 },
      expiresAt: { lte: now },
    },
  });

  let totalCoinsExpired = 0;

  for (const batch of expiredBatches) {
    const coinsToExpire = batch.remainingCoins;
    if (coinsToExpire <= 0) continue;

    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: batch.customerId },
      });
      if (!customer) return;

      const balanceBefore = customer.points;
      const balanceAfter = Math.max(0, balanceBefore - coinsToExpire);

      // Record EXPIRY transaction
      await tx.rewardTransaction.create({
        data: {
          customerId: batch.customerId,
          type: RewardTxType.EXPIRY,
          amount: -coinsToExpire,
          balanceBefore,
          balanceAfter,
          remainingCoins: 0,
          status: RewardTxStatus.EXPIRED,
          notes: `Batch expired (Credit date: ${batch.createdAt.toISOString().slice(0, 10)})`,
        },
      });

      // Update original batch
      await tx.rewardTransaction.update({
        where: { id: batch.id },
        data: {
          remainingCoins: 0,
          status: RewardTxStatus.EXPIRED,
        },
      });

      // Update customer points
      await tx.customer.update({
        where: { id: batch.customerId },
        data: { points: balanceAfter },
      });

      totalCoinsExpired += coinsToExpire;
    });
  }

  return {
    expiredBatches: expiredBatches.length,
    totalCoinsExpired,
  };
}

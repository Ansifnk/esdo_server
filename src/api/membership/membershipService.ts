import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';

export interface MembershipSummary {
  hasMembership: boolean;
  totalBalance: number;
  nearestExpiryDate: string | null; // ISO string or null for infinite/none
  isInfinite: boolean; // true if active membership has no expiry
  activeMembershipsCount: number;
  memberships: any[];
}

/**
 * Get active membership summary for a customer
 */
export async function getCustomerMembershipSummary(customerId: string): Promise<MembershipSummary> {
  const now = new Date();

  // Find all active memberships that have balance > 0 and haven't expired
  const allActiveMemberships = await prisma.membership.findMany({
    where: {
      customerId,
      isActive: true,
      balance: { gt: 0 },
      OR: [
        { endDate: null },
        { endDate: { gte: now } },
      ],
    },
    orderBy: [
      // Expiring first, infinite (null) last
      { endDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  const totalBalance = allActiveMemberships.reduce((sum, m) => sum + m.balance, 0);
  const hasMembership = allActiveMemberships.length > 0;

  // Find nearest expiry date among active memberships
  let nearestExpiryDate: string | null = null;
  let hasInfinite = false;

  for (const m of allActiveMemberships) {
    if (m.endDate) {
      if (!nearestExpiryDate || new Date(m.endDate) < new Date(nearestExpiryDate)) {
        nearestExpiryDate = m.endDate.toISOString();
      }
    } else {
      hasInfinite = true;
    }
  }

  return {
    hasMembership,
    totalBalance,
    nearestExpiryDate,
    isInfinite: hasInfinite && !nearestExpiryDate,
    activeMembershipsCount: allActiveMemberships.length,
    memberships: allActiveMemberships,
  };
}

/**
 * Deduct an amount from customer's active memberships (FIFO / nearest expiry first)
 */
export async function deductCustomerMembershipBalance(
  customerId: string,
  amountToDeduct: number,
  bookingId?: string,
  txClient?: any
) {
  if (amountToDeduct <= 0) return { deducted: 0 };

  const db = txClient || prisma;
  const now = new Date();

  // Fetch active memberships ordered by expiring soonest
  const activeMemberships = await db.membership.findMany({
    where: {
      customerId,
      isActive: true,
      balance: { gt: 0 },
      OR: [
        { endDate: null },
        { endDate: { gte: now } },
      ],
    },
    orderBy: [
      { endDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  const totalAvailable = activeMemberships.reduce((acc: number, m: any) => acc + m.balance, 0);
  if (totalAvailable < amountToDeduct) {
    throw new AppError(
      `Insufficient membership balance. Available: ₹${totalAvailable}, Requested: ₹${amountToDeduct}`,
      400
    );
  }

  let remaining = amountToDeduct;
  const transactionsCreated = [];

  for (const mem of activeMemberships) {
    if (remaining <= 0) break;

    const deductFromThis = Math.min(remaining, mem.balance);
    const balanceBefore = mem.balance;
    const balanceAfter = Math.max(0, mem.balance - deductFromThis);

    await db.membership.update({
      where: { id: mem.id },
      data: {
        balance: balanceAfter,
      },
    });

    const tx = await db.membershipTransaction.create({
      data: {
        membershipId: mem.id,
        type: 'DEBIT',
        amount: deductFromThis,
        balanceBefore,
        balanceAfter,
        bookingId: bookingId || null,
        note: bookingId ? `Redeemed on booking` : `Redeemed on order`,
      },
    });

    transactionsCreated.push(tx);
    remaining -= deductFromThis;
  }

  return {
    deducted: amountToDeduct,
    transactions: transactionsCreated,
  };
}

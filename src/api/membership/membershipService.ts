import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';
import { RAZORPAY_KEY_SECRET } from '../../configs/env';

export interface MembershipSummary {
  hasMembership: boolean;
  totalBalance: number;
  nearestExpiryDate: string | null; // ISO string or null for infinite/none
  isInfinite: boolean; // true if active membership has no expiry
  activeMembershipsCount: number;
  memberships: any[];
  isExpired: boolean; // true if customer has no active memberships, but previously had expired ones
  canRenew: boolean; // strictly true ONLY when current membership has expired
  expiredMemberships: any[];
  lastExpiredDate: string | null;
}

/**
 * Get active membership summary for a customer
 */
export async function getCustomerMembershipSummary(customerId: string): Promise<MembershipSummary> {
  const now = new Date();

  // Find all active memberships that haven't expired (including those with 0 balance)
  const allActiveMemberships = await prisma.membership.findMany({
    where: {
      customerId,
      isActive: true,
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

  // Find all expired memberships (for renewal logic and history)
  const expiredMemberships = await prisma.membership.findMany({
    where: {
      customerId,
      isActive: true,
      endDate: { lt: now },
    },
    orderBy: { endDate: 'desc' },
  });

  const totalBalance = allActiveMemberships.reduce((sum, m) => sum + Math.max(0, m.balance), 0);
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

  // Strict constraint: Can ONLY renew once expired!
  const isExpired = !hasMembership && expiredMemberships.length > 0;
  const canRenew = isExpired;
  const lastExpiredDate = expiredMemberships[0]?.endDate ? expiredMemberships[0].endDate.toISOString() : null;

  return {
    hasMembership,
    totalBalance,
    nearestExpiryDate,
    isInfinite: hasInfinite && !nearestExpiryDate,
    activeMembershipsCount: allActiveMemberships.length,
    memberships: allActiveMemberships,
    isExpired,
    canRenew,
    expiredMemberships,
    lastExpiredDate,
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

export interface ActivateMembershipPaymentParams {
  customerId: string;
  planId: string;
  isRenewal?: boolean;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  skipSignatureCheck?: boolean;
}

/**
 * Activate or renew membership after a verified payment (from controller or webhook)
 */
export async function activateMembershipPayment({
  customerId,
  planId,
  isRenewal = false,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  skipSignatureCheck = false,
}: ActivateMembershipPaymentParams) {
  // Find the plan
  const plan = await prisma.membershipPlan.findUnique({
    where: { id: String(planId) },
  });

  if (!plan) {
    throw new AppError('Selected membership plan not found', 404);
  }

  // Find payment record
  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId },
  });

  if (!payment) {
    throw new AppError('Payment record not found for this order', 404);
  }

  // Check if payment was already successfully processed (Idempotency)
  if (payment.status === 'SUCCESS') {
    const summary = await getCustomerMembershipSummary(customerId);
    const existingMembership = summary.memberships[0] || null;
    return {
      newMembership: existingMembership,
      updatedPayment: payment,
      summary,
      alreadyProcessed: true,
    };
  }

  // Enforce renewal check
  const summary = await getCustomerMembershipSummary(customerId);
  if (isRenewal && !summary.canRenew) {
    throw new AppError(
      'Current membership is still active. Renewal is only permitted once current membership expires.',
      400
    );
  }

  // Verify signature if not test/mock and signature verification is not skipped
  if (!skipSignatureCheck) {
    const isMock =
      razorpayPaymentId?.startsWith('pay_mock_') ||
      razorpayPaymentId?.startsWith('pay_test_') ||
      razorpayOrderId?.startsWith('order_mock_');

    if (!isMock && RAZORPAY_KEY_SECRET && razorpaySignature && razorpayPaymentId) {
      const body = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== razorpaySignature) {
        throw new AppError('Invalid payment signature', 400);
      }
    }
  }

  // Calculate dates
  const startDate = new Date();
  let endDate: Date | null = null;
  if (plan.validityMonths > 0) {
    endDate = new Date();
    endDate.setMonth(endDate.getMonth() + plan.validityMonths);
  }

  // Carry forward any unspent balance if renewing
  let carryForwardBalance = 0;
  if (isRenewal && summary.expiredMemberships.length > 0) {
    carryForwardBalance = summary.expiredMemberships.reduce(
      (sum, m) => sum + Math.max(0, m.balance || 0),
      0
    );
  }

  const totalNewBalance = plan.benefitValue + carryForwardBalance;

  // Database transaction to update payment & create membership
  const result = await prisma.$transaction(async (tx) => {
    // 1. Update Payment
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        razorpayPaymentId: razorpayPaymentId || `pay_rzp_${Date.now()}`,
        razorpaySignature: razorpaySignature || 'webhook_verified',
      },
    });

    // 2. If renewing, mark expired memberships' remaining balance to 0 so it's not double-counted
    if (isRenewal && carryForwardBalance > 0) {
      for (const expMem of summary.expiredMemberships) {
        if (expMem.balance > 0) {
          await tx.membership.update({
            where: { id: expMem.id },
            data: { balance: 0 },
          });
        }
      }
    }

    // 3. Create Membership
    const note = isRenewal ? `${plan.name} (Renewed)` : plan.name;

    const newMembership = await tx.membership.create({
      data: {
        customerId,
        amount: plan.amount,
        initialValue: totalNewBalance,
        balance: totalNewBalance,
        startDate,
        endDate,
        isActive: true,
        note,
      },
      include: {
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    // 4. Create CREDIT Transaction
    const txNote = isRenewal
      ? `Membership renewed with ${plan.name}. Paid ₹${plan.amount} for ₹${plan.benefitValue} benefit${
          carryForwardBalance > 0 ? ` + ₹${carryForwardBalance} rolled-over unspent balance` : ''
        }.`
      : `Membership joined with ${plan.name}. Paid ₹${plan.amount} for ₹${plan.benefitValue} benefit value.`;

    await tx.membershipTransaction.create({
      data: {
        membershipId: newMembership.id,
        type: 'CREDIT',
        amount: totalNewBalance,
        balanceBefore: 0,
        balanceAfter: totalNewBalance,
        note: txNote,
      },
    });

    return { newMembership, updatedPayment };
  });

  const updatedSummary = await getCustomerMembershipSummary(customerId);

  return {
    newMembership: result.newMembership,
    updatedPayment: result.updatedPayment,
    summary: updatedSummary,
    alreadyProcessed: false,
  };
}

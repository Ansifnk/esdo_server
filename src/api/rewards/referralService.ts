import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';
import { ReferralStatus, RewardTxType } from '../../generated/prisma/enums';
import { rewardSettingService } from './rewardSettingService';
import { rewardCoinService } from './rewardCoinService';
import { generateUniqueReferralCode } from './rewardUtils';
import { CLIENT_URL } from '../../configs/env';

export const referralService = {
  /**
   * Ensure customer has a unique referral code
   */
  async ensureCustomerReferralCode(customer: { id: string; referralCode?: string | null }) {
    if (customer.referralCode) return customer.referralCode;

    const newCode = await generateUniqueReferralCode();
    await prisma.customer.update({
      where: { id: customer.id },
      data: { referralCode: newCode },
    });
    return newCode;
  },

  /**
   * Link a new customer to a referrer using a referral code
   */
  async applyReferralCode(newCustomerId: string, referralCode: string, externalTx?: any) {
    const client = externalTx || prisma;

    if (!referralCode || !referralCode.trim()) return;

    const cleanCode = referralCode.trim().toUpperCase();

    // Find referrer
    const referrer = await client.customer.findUnique({
      where: { referralCode: cleanCode },
    });

    if (!referrer) {
      throw new AppError('Invalid referral code', 400);
    }

    if (referrer.id === newCustomerId) {
      throw new AppError('You cannot refer yourself', 400);
    }

    const newCustomer = await client.customer.findUnique({
      where: { id: newCustomerId },
      include: { bookings: true, referralReceived: true },
    });

    if (!newCustomer) throw new AppError('Customer not found', 404);

    // Referral is only valid for first-time customers who haven't made a booking
    if (newCustomer.bookings.length > 0) {
      throw new AppError('Referral code can only be used by first-time customers before placing an order', 400);
    }

    if (newCustomer.referralReceived || newCustomer.referredById) {
      throw new AppError('A referral code has already been applied to your account', 400);
    }

    // Determine referrer's next referral number
    const existingReferralsCount = await client.referral.count({
      where: { referrerId: referrer.id },
    });
    const referralNumber = existingReferralsCount + 1;

    // Link customer and create Referral record
    await client.customer.update({
      where: { id: newCustomerId },
      data: { referredById: referrer.id },
    });

    return client.referral.create({
      data: {
        referrerId: referrer.id,
        referredCustomerId: newCustomerId,
        referralCodeUsed: cleanCode,
        referralNumber,
        status: ReferralStatus.PENDING,
      },
    });
  },

  /**
   * Validate referral code for checkout welcome discount
   */
  async validateReferralCodeForWelcomeDiscount(customerId: string, referralCode: string) {
    const settings = await rewardSettingService.getSettings();
    if (!settings.isReferralEnabled) {
      throw new AppError('Referral program is currently inactive', 400);
    }

    const cleanCode = referralCode.trim().toUpperCase();
    const referrer = await prisma.customer.findUnique({
      where: { referralCode: cleanCode },
    });

    if (!referrer) {
      throw new AppError('Invalid referral code', 400);
    }

    if (referrer.id === customerId) {
      throw new AppError('You cannot use your own referral code', 400);
    }

    // Check if customer already placed any completed booking
    const pastBookings = await prisma.booking.count({
      where: { customerId, status: { not: 'CANCELLED' } },
    });

    if (pastBookings > 0) {
      throw new AppError('Referral welcome discount is only valid on your first booking', 400);
    }

    return {
      valid: true,
      discountAmount: settings.referredUserDiscountAmount,
      minOrderAmount: settings.referredUserMinOrderAmount,
      referrerName: referrer.name || 'Friend',
    };
  },

  /**
   * Handle qualification when a referred customer completes their first booking
   */
  async handleBookingCompletion(booking: {
    id: string;
    customerId: string;
    totalAmount: number;
  }, externalTx?: any) {
    const client = externalTx || prisma;

    // Check if this customer has a pending referral
    const referral = await client.referral.findUnique({
      where: { referredCustomerId: booking.customerId },
      include: { referrer: true },
    });

    if (!referral || referral.status !== ReferralStatus.PENDING) {
      return;
    }

    // Check if this is indeed the customer's first completed booking
    const priorCompleted = await client.booking.count({
      where: {
        customerId: booking.customerId,
        id: { not: booking.id },
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'SUCCESS',
      },
    });

    if (priorCompleted > 0) {
      // Not first booking
      return;
    }

    const settings = await rewardSettingService.getSettings();
    if (!settings.isReferralEnabled) return;

    // Count how many prior QUALIFIED referrals this referrer has completed
    const qualifiedCount = await client.referral.count({
      where: {
        referrerId: referral.referrerId,
        status: ReferralStatus.QUALIFIED,
      },
    });

    const referralNumber = qualifiedCount + 1;

    // Check slabs table for this referral number
    const slab = await client.referralRewardSlab.findUnique({
      where: { referralCount: referralNumber },
    });

    let coinsToAward = settings.defaultReferralCoins;
    let milestoneUnlocked = false;
    let milestoneTitle: string | null = null;

    if (slab && slab.isActive) {
      coinsToAward = slab.coinsEarned;
      if (slab.hasMilestoneReward) {
        milestoneUnlocked = true;
        milestoneTitle = slab.milestoneTitle || 'Free service unlocked';
      }
    }

    // Credit referrer with coins
    if (coinsToAward > 0) {
      await rewardCoinService.creditCoins({
        customerId: referral.referrerId,
        amount: coinsToAward,
        type: RewardTxType.REFERRAL_EARN,
        bookingId: booking.id,
        referralId: referral.id,
        notes: `Referral reward for referral #${referralNumber}`,
        externalTx: client,
      });
    }

    // Mark referral as QUALIFIED
    await client.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.QUALIFIED,
        coinsAwarded: coinsToAward,
        milestoneUnlocked,
        milestoneTitle,
        referralNumber,
        qualifyingBookingId: booking.id,
      },
    });
  },

  /**
   * Get customer's referral dashboard profile & stats
   */
  async getCustomerReferralProfile(customerId: string) {
    let customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        referralsMade: {
          include: {
            referralReceived: true,
          },
        },
        referralRecords: {
          include: {
            referredCustomer: {
              select: { id: true, name: true, phone: true, createdAt: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) throw new AppError('Customer not found', 404);

    if (!customer.referralCode) {
      const code = await this.ensureCustomerReferralCode(customer);
      customer.referralCode = code;
    }

    const settings = await rewardSettingService.getSettings();
    const slabs = await rewardSettingService.getReferralSlabs();

    const totalReferrals = customer.referralRecords.length;
    const completedReferrals = customer.referralRecords.filter((r) => r.status === ReferralStatus.QUALIFIED).length;
    const totalCoinsEarned = customer.referralRecords.reduce((sum, r) => sum + (r.coinsAwarded || 0), 0);

    const origin = (CLIENT_URL || process.env.CLIENT_URL || 'https://www.esdo.in').replace(/\/+$/, '');
    const shareUrl = `${origin}/?ref=${customer.referralCode}`;
    const whatsappMessage = settings.shareMessageTemplate
      .replace('{code}', customer.referralCode)
      .replace('{discount}', String(settings.referredUserDiscountAmount))
      .replace('{url}', shareUrl);

    return {
      referralCode: customer.referralCode,
      shareUrl,
      whatsappMessage,
      totalReferrals,
      completedReferrals,
      totalCoinsEarned,
      welcomeDiscount: settings.referredUserDiscountAmount,
      referredFriends: customer.referralRecords.map((r) => ({
        id: r.id,
        name: r.referredCustomer?.name || 'Customer',
        phoneMasked: r.referredCustomer?.phone ? `${r.referredCustomer.phone.slice(0, 3)}****${r.referredCustomer.phone.slice(-3)}` : '',
        status: r.status,
        coinsAwarded: r.coinsAwarded,
        milestoneUnlocked: r.milestoneUnlocked,
        milestoneTitle: r.milestoneTitle,
        date: r.createdAt,
      })),
      slabs: slabs.map((s) => ({
        count: s.referralCount,
        coins: s.coinsEarned,
        hasMilestone: s.hasMilestoneReward,
        milestoneTitle: s.milestoneTitle,
        isCompleted: completedReferrals >= s.referralCount,
      })),
    };
  },
};

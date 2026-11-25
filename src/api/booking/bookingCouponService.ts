import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';
import { referralService } from '../rewards/referralService';

export interface ValidateBookingCouponParams {
  couponCode?: string | null;
  customerId?: string | null;
  subtotal: number;
  saloonId?: string | null;
}

export interface ValidatedBookingCouponResult {
  couponCode: string;
  couponDiscount: number;
  source: 'OFFER' | 'REFERRAL' | null;
  offerId?: string;
  offerName?: string;
  discountType?: 'PERCENTAGE' | 'FIXED';
  discountValue?: number;
}

/**
 * Validates a coupon or referral code for an admin booking and computes the discount amount.
 */
export async function validateAndCalculateCouponDiscount({
  couponCode,
  customerId,
  subtotal,
  saloonId,
}: ValidateBookingCouponParams): Promise<ValidatedBookingCouponResult> {
  const trimmed = typeof couponCode === 'string' ? couponCode.trim() : '';
  if (!trimmed) {
    return { couponCode: '', couponDiscount: 0, source: null };
  }

  const offer = await prisma.offer.findFirst({
    where: {
      couponCode: { equals: trimmed, mode: 'insensitive' },
      isActive: true,
    },
    include: {
      customers: {
        select: { id: true },
      },
    },
  });

  if (offer) {
    if (offer.saloonId && saloonId && offer.saloonId !== saloonId) {
      throw new AppError('This coupon code is not valid for the selected saloon.', 400);
    }

    const isCustomerAllowed =
      !offer.customers ||
      offer.customers.length === 0 ||
      (Boolean(customerId) && offer.customers.some((c) => c.id === customerId));

    if (!isCustomerAllowed) {
      throw new AppError('This coupon code is not valid for the selected customer.', 400);
    }

    const now = new Date();
    if (offer.startDate && new Date(offer.startDate) > now) {
      throw new AppError('This coupon is not active yet.', 400);
    }
    if (offer.endDate && new Date(offer.endDate) < now) {
      throw new AppError('This coupon has expired.', 400);
    }

    if (offer.onlyForFirstService) {
      if (!customerId) {
        throw new AppError('Please select a customer first. This coupon is valid only for a first service.', 400);
      }
      const existingBookingCount = await prisma.booking.count({
        where: {
          customerId,
          status: { notIn: ['CANCELLED', 'DUMMY_BOOKING'] },
        },
      });
      if (existingBookingCount > 0) {
        throw new AppError('This coupon is valid only for the customer\'s first service.', 400);
      }
    }

    if (offer.minCartValue && offer.minCartValue > 0 && subtotal < offer.minCartValue) {
      throw new AppError(
        `Minimum booking value of ₹${offer.minCartValue} is required to apply coupon ${offer.couponCode}.`,
        400
      );
    }

    let rawDiscount = 0;
    if (offer.discountType === 'PERCENTAGE') {
      rawDiscount = Math.round(((subtotal * offer.discountValue) / 100) * 100) / 100;
    } else if (offer.discountType === 'FIXED') {
      rawDiscount = offer.discountValue;
    }

    const couponDiscount = Math.max(0, Math.min(rawDiscount, subtotal));

    return {
      couponCode: offer.couponCode,
      couponDiscount,
      source: 'OFFER',
      offerId: offer.id,
      offerName: offer.name,
      discountType: offer.discountType as 'PERCENTAGE' | 'FIXED',
      discountValue: offer.discountValue,
    };
  }

  // Fallback: check referral welcome code
  if (!customerId) {
    throw new AppError('Invalid coupon code. Select a customer first if applying a referral code.', 400);
  }

  try {
    const referralCheck = await referralService.validateReferralCodeForWelcomeDiscount(customerId, trimmed);
    if (subtotal < referralCheck.minOrderAmount) {
      throw new AppError(
        `Minimum booking value of ₹${referralCheck.minOrderAmount} is required for this referral code.`,
        400
      );
    }
    const couponDiscount = Math.max(0, Math.min(referralCheck.discountAmount, subtotal));
    return {
      couponCode: trimmed.toUpperCase(),
      couponDiscount,
      source: 'REFERRAL',
      offerName: `Referral (${referralCheck.referrerName})`,
      discountType: 'FIXED',
      discountValue: referralCheck.discountAmount,
    };
  } catch (err: any) {
    if (err instanceof AppError && err.message === 'Invalid referral code') {
      throw new AppError('Invalid or inactive coupon code.', 400);
    }
    throw err;
  }
}

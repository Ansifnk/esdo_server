import { Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } from '../../configs/env';
import { generateOrGetInvoiceForBooking, isMembershipOnlyBooking } from '../invoice/invoiceService';
import {
  extractDateMatchKey,
  normalizeTimeSlot,
  isStaffSlotAvailable,
  isSlotInPast,
  getItemDuration,
  doSlotRangesOverlap,
} from '../staff/controller';
import { deductCustomerMembershipBalance, getCustomerMembershipSummary, activateMembershipPayment } from '../membership/membershipService';
import { rewardCoinService } from '../rewards/rewardCoinService';
import { referralService } from '../rewards/referralService';
import { RewardTxType, PaymentMode } from '../../generated/prisma/enums';
import { sendBookingDetailsSms } from '../../utils/smsUtils';
import { getItemOriginalPrice, getItemDiscountedPrice } from '../cart/cartController';

// Initialize Razorpay client instance
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

/**
 * Helper to calculate subtotal and coupon discount for customer's cart
 */
async function getCartTotalAndDiscount(cart: any) {
  const items = cart.items || [];
  let subtotal = 0;
  let originalServiceTotal = 0;
  let hasPackage = false;

  for (const item of items) {
    if (item.packageId || item.package) {
      hasPackage = true;
    }
    const itemOriginalPrice = getItemOriginalPrice(item);
    const itemPrice = getItemDiscountedPrice(item);

    originalServiceTotal += itemOriginalPrice;
    subtotal += itemPrice;
  }

  let discount = 0;
  if (cart.couponCode) {
    const trimmed = cart.couponCode.trim();
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
      const isCustomerAllowed =
        !offer.customers ||
        offer.customers.length === 0 ||
        (Boolean(cart.customerId) && offer.customers.some((c) => c.id === cart.customerId));

      const now = new Date();
      const isDateValid = (!offer.startDate || new Date(offer.startDate) <= now) &&
                          (!offer.endDate || new Date(offer.endDate) >= now);

      let isFirstServiceEligible = true;
      if (offer.onlyForFirstService) {
        if (!cart.customerId) {
          isFirstServiceEligible = false;
        } else {
          const existingBookingCount = await prisma.booking.count({
            where: {
              customerId: cart.customerId,
              status: { notIn: ['CANCELLED', 'DUMMY_BOOKING'] },
            },
          });
          if (existingBookingCount > 0) {
            isFirstServiceEligible = false;
          }
        }
      }

      if (!isCustomerAllowed) {
        discount = 0;
      } else if (!isFirstServiceEligible) {
        discount = 0;
      } else if (!isDateValid) {
        discount = 0;
      } else if (offer.minCartValue && offer.minCartValue > 0 && subtotal < offer.minCartValue) {
        discount = 0;
      } else if (offer.discountType === 'PERCENTAGE') {
        discount = (subtotal * offer.discountValue) / 100;
      } else if (offer.discountType === 'FIXED') {
        discount = offer.discountValue;
      }
    } else {
      try {
        const referralCheck = await referralService.validateReferralCodeForWelcomeDiscount(
          cart.customerId,
          trimmed
        );
        if (referralCheck.valid && subtotal >= referralCheck.minOrderAmount) {
          discount = referralCheck.discountAmount;
        }
      } catch (_e) { }
    }
  }

  discount = Math.min(discount, subtotal);
  return { subtotal, originalServiceTotal, hasPackage, couponDiscount: discount };
}

/**
 * Shared Helper: Create Booking from Cart & Clear Cart
 */
export async function createBookingAndClearCart(
  customerId: string,
  payment: any,
  pointsToUse: number = 0,
  membershipToUse: number = 0,
  isMembershipPayment: boolean = false,
  paymentModeOverride?: PaymentMode
) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const cart = await prisma.cart.findUnique({
    where: { customerId },
    include: {
      items: {
        include: {
          service: true,
          package: true,
          staff: true,
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    // If cart is already empty, check if booking was already created for this payment
    if (payment?.id) {
      const existingBooking = await prisma.booking.findUnique({
        where: { paymentId: payment.id },
        include: {
          items: {
            include: {
              service: true,
              package: {
                include: {
                  services: true,
                },
              },
              staff: true,
            },
          },
        },
      });
      if (existingBooking) return existingBooking;
    }
    throw new AppError('Cart is empty', 400);
  }

  const { subtotal, originalServiceTotal, hasPackage, couponDiscount } = await getCartTotalAndDiscount(cart);

  let bookingSubtotal = 0;
  let finalDiscount = 0;
  let actualCouponDiscount = 0;
  let actualRewardDiscount = 0;
  let totalAmount = 0;
  let actualMembershipUsed = 0;
  let actualPointsUsed = 0;
  let pointsEarned = 0;
  let savedCouponCode = '';

  if (isMembershipPayment || membershipToUse > 0) {
    // Membership payment:
    // 1. Must not have packages
    if (hasPackage) {
      throw new AppError('Packages cannot be purchased using membership balance. Please proceed with online payment.', 400);
    }

    // 2. Must not exceed membership balance
    const memSummary = await getCustomerMembershipSummary(customerId);
    if (!memSummary.hasMembership || memSummary.totalBalance < originalServiceTotal) {
      throw new AppError(
        `Cart total (₹${originalServiceTotal}) exceeds available membership balance (₹${memSummary.totalBalance || 0}). Split payment is not allowed. Please proceed with online payment.`,
        400
      );
    }

    // 3. Takes original service price, no discounts, no coupons
    bookingSubtotal = originalServiceTotal;
    finalDiscount = 0;
    actualMembershipUsed = originalServiceTotal;
    totalAmount = 0;
    actualPointsUsed = 0;
    savedCouponCode = '';
    pointsEarned = await rewardCoinService.calculateCoinsEarned(bookingSubtotal);
  } else {
    // Online payment (Razorpay):
    // 1. Takes discounted subtotal
    // 2. Rewards and coupon discounts applied
    const { allowedPoints, discountAmount: pointsDiscountAmount } =
      await rewardCoinService.validateRedemption({
        customerPoints: customer.points,
        subtotal,
        pointsToUse,
        hasCoupon: Boolean(cart.couponCode),
      });

    actualPointsUsed = allowedPoints;
    actualCouponDiscount = couponDiscount;
    actualRewardDiscount = pointsDiscountAmount;
    finalDiscount = couponDiscount + pointsDiscountAmount;
    const taxableBase = Math.max(0, subtotal - finalDiscount);

    // 3. Add 5% tax
    const taxAmount = Math.round(taxableBase * 0.05 * 100) / 100;
    totalAmount = Math.round((taxableBase + taxAmount) * 100) / 100;

    bookingSubtotal = subtotal;
    actualMembershipUsed = 0;
    savedCouponCode = cart.couponCode || '';
    pointsEarned = await rewardCoinService.calculateCoinsEarned(subtotal);
  }

  // Extract saloonId if available from service or package
  let saloonId: string | null = null;
  for (const item of cart.items) {
    if (item.service?.saloonId) {
      saloonId = item.service.saloonId;
      break;
    }
    if (item.package?.saloonId) {
      saloonId = item.package.saloonId;
      break;
    }
  }

  const bookingNumber = `BK-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Use transaction to create Booking, BookingItems, deduct Membership, update Customer points, clear Cart
  const booking = await prisma.$transaction(async (tx) => {
    // Create Booking
    const newBooking = await tx.booking.create({
      data: {
        bookingNumber,
        source: 'WEBSITE',
        customerId,
        saloonId,
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
        paymentMode: isMembershipPayment
          ? PaymentMode.MEMBERSHIP
          : (paymentModeOverride || PaymentMode.UPI),
        subtotal: bookingSubtotal,
        discount: finalDiscount,
        couponDiscount: actualCouponDiscount,
        rewardDiscount: actualRewardDiscount,
        totalAmount,
        pointsUsed: actualPointsUsed,
        membershipUsed: actualMembershipUsed,
        pointsEarned,
        couponCode: savedCouponCode,
        paymentId: payment ? payment.id : null,
        items: {
          create: cart.items.map((item) => {
            const itemPrice = isMembershipPayment
              ? getItemOriginalPrice(item)
              : getItemDiscountedPrice(item);
            return {
              serviceId: item.serviceId,
              packageId: item.packageId,
              staffId: item.staffId,
              date: item.date,
              timeSlot: item.timeSlot || '',
              price: itemPrice,
            };
          }),
        },
      },
      include: {
        customer: true,
        items: {
          include: {
            service: true,
            package: {
              include: {
                services: true,
              },
            },
            staff: true,
          },
        },
        saloon: true,
      },
    });

    // Deduct membership balance if used
    if (actualMembershipUsed > 0) {
      await deductCustomerMembershipBalance(customerId, actualMembershipUsed, newBooking.id, tx);
    }

    // Deduct redeemed coins using FIFO batch consumption
    if (actualPointsUsed > 0) {
      await rewardCoinService.deductCoinsFIFO(customerId, actualPointsUsed, newBooking.id, tx);
    }

    // Credit earned coins with dynamic expiry
    if (pointsEarned > 0) {
      await rewardCoinService.creditCoins({
        customerId,
        amount: pointsEarned,
        type: RewardTxType.SPEND_EARN,
        bookingId: newBooking.id,
        notes: `Earned from booking ${bookingNumber}`,
        externalTx: tx,
      });
    }

    // Trigger referral qualification if applicable
    await referralService.handleBookingCompletion(
      { id: newBooking.id, customerId, totalAmount },
      tx
    );

    // Delete cart items & clear coupon
    await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
    await tx.cart.update({
      where: { id: cart.id },
      data: { couponCode: '' },
    });

    return newBooking;
  });

  // Automatically generate invoice upon booking & payment completion (skip for membership-paid bookings)
  if (!isMembershipPayment && !isMembershipOnlyBooking(booking)) {
    try {
      await generateOrGetInvoiceForBooking(booking.id);
    } catch (invErr) {
      console.error('Failed to auto-generate invoice:', invErr);
    }
  }

  // Send Booking Details SMS to customer
  const customerPhone = customer.phone || (booking as any)?.customer?.phone;
  if (customerPhone) {
    try {
      const smsResult = await sendBookingDetailsSms(customerPhone, booking.bookingNumber);
      if (!smsResult.success) {
        console.warn('[PAYMENT BOOKING SMS FAILED]', smsResult.message || smsResult.error);
      }
    } catch (smsErr) {
      console.error('Failed to send booking SMS upon payment completion:', smsErr);
    }
  }

  return booking;
}

/**
 * POST /api/payment/create-order
 * Create Razorpay Order and Payment Record
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const { pointsToUse = 0, membershipToUse = 0 } = req.body;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const cart = await prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            service: true,
            package: {
              include: {
                services: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError('Your cart is empty', 400);
    }

    // Verify none of the items in the cart are unavailable or already booked
    for (let i = 0; i < cart.items.length; i++) {
      const itemA = cart.items[i];
      const durationA = getItemDuration(itemA);

      for (let j = i + 1; j < cart.items.length; j++) {
        const itemB = cart.items[j];
        if (
          itemA.staffId &&
          itemB.staffId &&
          itemA.staffId === itemB.staffId &&
          extractDateMatchKey(itemA.date || '') === extractDateMatchKey(itemB.date || '')
        ) {
          const durationB = getItemDuration(itemB);
          if (doSlotRangesOverlap(itemA.timeSlot || '', durationA, itemB.timeSlot || '', durationB)) {
            throw new AppError(
              `A stylist cannot be assigned to multiple services at overlapping time slots (${itemA.timeSlot} - ${itemB.timeSlot}). Please choose different stylists or time slots.`,
              400
            );
          }
        }
      }

      if (itemA.date && itemA.timeSlot && isSlotInPast(itemA.date, itemA.timeSlot)) {
        throw new AppError(
          `The scheduled time slot (${itemA.timeSlot} on ${itemA.date}) has already passed. Please remove or reschedule this item before checkout.`,
          400
        );
      }

      if (itemA.staffId && itemA.date && itemA.timeSlot) {
        const slotCheck = await isStaffSlotAvailable(itemA.staffId, itemA.date, itemA.timeSlot, durationA);
        if (!slotCheck.available) {
          throw new AppError(
            slotCheck.reason ||
              `The slot "${itemA.timeSlot}" on "${itemA.date}" is no longer available. Please choose another slot before checking out.`,
            400
          );
        }
      }
    }

    const { subtotal, couponDiscount } = await getCartTotalAndDiscount(cart);

    // Online payment: rewards and coupons apply, split membership is not allowed
    const { allowedPoints: validPointsToUse, discountAmount: pointsDiscount } =
      await rewardCoinService.validateRedemption({
        customerPoints: customer.points,
        subtotal,
        pointsToUse,
        hasCoupon: Boolean(cart.couponCode),
      });

    const taxableAmount = Math.max(0, subtotal - couponDiscount - pointsDiscount);
    const taxAmount = Math.round(taxableAmount * 0.05 * 100) / 100;
    const finalTotal = Math.round((taxableAmount + taxAmount) * 100) / 100;

    const amountInPaise = Math.round(finalTotal * 100);

    const receipt = `rcpt_${Date.now()}`;
    let razorpayOrder: any;

    try {
      razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise > 0 ? amountInPaise : 100, // min 1 INR for order creation
        currency: 'INR',
        receipt,
        notes: {
          customerId,
          cartId: cart.id,
          pointsToUse: validPointsToUse,
          membershipToUse: 0,
        },
      });
    } catch (rzpErr: any) {
      console.warn('Razorpay API error, generating mock order for dev testing:', rzpErr.message);
      razorpayOrder = {
        id: `order_mock_${Date.now()}`,
        amount: amountInPaise,
        currency: 'INR',
        receipt,
      };
    }

    // Save Payment record in DB
    const payment = await prisma.payment.create({
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: finalTotal,
        currency: 'INR',
        status: 'PENDING',
        customerId,
      },
    });

    res.json(
      new AppResponse('Razorpay order created successfully', {
        orderId: razorpayOrder.id,
        paymentId: payment.id,
        amount: finalTotal,
        amountInPaise,
        currency: 'INR',
        keyId: RAZORPAY_KEY_ID,
        pointsToUse: validPointsToUse,
        membershipToUse: 0,
        taxAmount,
        couponCode: cart.couponCode,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to create payment order', {}, statusCode));
  }
};

/**
 * POST /api/payment/verify-and-create-booking
 * Verify Razorpay payment signature & create booking
 */
export const verifyAndCreateBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      pointsToUse = 0,
      paymentMode,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId) {
      throw new AppError('Missing payment details', 400);
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
      include: {
        booking: {
          include: {
            items: {
              include: {
                service: true,
                package: {
                  include: {
                    services: true,
                  },
                },
                staff: true,
              },
            },
            customer: true,
            saloon: true,
          },
        },
      },
    });

    if (!payment) {
      throw new AppError('Payment record not found', 404);
    }

    // If webhook already processed and created booking (Idempotency)
    if (payment.status === 'SUCCESS' && payment.booking) {
      res.json(
        new AppResponse('Payment verified and booking created successfully', {
          booking: payment.booking,
          payment,
        })
      );
      return;
    }

    // Signature verification
    const isMock = razorpayOrderId.startsWith('order_mock_');
    if (!isMock && razorpaySignature) {
      const generatedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      if (generatedSignature !== razorpaySignature) {
        // Mark payment as FAILED
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' },
        });
        throw new AppError('Invalid payment signature', 400);
      }
    }

    // Update payment record to SUCCESS
    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        razorpayPaymentId,
        razorpaySignature: razorpaySignature || 'mock_sig',
      },
    });

    // Create booking and clear cart (Online payment: membershipToUse = 0, isMembership = false)
    const booking = await createBookingAndClearCart(
      customerId,
      updatedPayment,
      pointsToUse,
      0,
      false,
      paymentMode
    );

    res.json(
      new AppResponse('Payment verified and booking created successfully', {
        booking,
        payment: updatedPayment,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to verify payment and create booking', {}, statusCode));
  }
};

/**
 * POST /api/payment/pay-with-membership
 * Direct checkout when order is 100% paid by membership benefits
 */
export const payWithMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const cart = await prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            service: true,
            package: {
              include: {
                services: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError('Your cart is empty', 400);
    }

    // Check slot availability and conflicts
    for (let i = 0; i < cart.items.length; i++) {
      const itemA = cart.items[i];
      const durationA = getItemDuration(itemA);

      for (let j = i + 1; j < cart.items.length; j++) {
        const itemB = cart.items[j];
        if (
          itemA.staffId &&
          itemB.staffId &&
          itemA.staffId === itemB.staffId &&
          extractDateMatchKey(itemA.date || '') === extractDateMatchKey(itemB.date || '')
        ) {
          const durationB = getItemDuration(itemB);
          if (doSlotRangesOverlap(itemA.timeSlot || '', durationA, itemB.timeSlot || '', durationB)) {
            throw new AppError(
              `A stylist cannot be assigned to multiple services at overlapping time slots (${itemA.timeSlot} - ${itemB.timeSlot}). Please choose different stylists or time slots.`,
              400
            );
          }
        }
      }

      if (itemA.date && itemA.timeSlot && isSlotInPast(itemA.date, itemA.timeSlot)) {
        throw new AppError(
          `The scheduled time slot (${itemA.timeSlot} on ${itemA.date}) has already passed. Please remove or reschedule this item before checkout.`,
          400
        );
      }

      if (itemA.staffId && itemA.date && itemA.timeSlot) {
        const slotCheck = await isStaffSlotAvailable(itemA.staffId, itemA.date, itemA.timeSlot, durationA);
        if (!slotCheck.available) {
          throw new AppError(
            slotCheck.reason ||
              `The slot "${itemA.timeSlot}" on "${itemA.date}" is no longer available. Please choose another slot before checking out.`,
            400
          );
        }
      }
    }

    const { originalServiceTotal, hasPackage } = await getCartTotalAndDiscount(cart);

    if (hasPackage) {
      throw new AppError(
        'Packages cannot be purchased using membership balance. Please proceed with online payment.',
        400
      );
    }

    const memSummary = await getCustomerMembershipSummary(customerId);
    if (!memSummary.hasMembership || memSummary.totalBalance < originalServiceTotal) {
      throw new AppError(
        `Cart total (₹${originalServiceTotal}) exceeds your available membership balance (₹${memSummary.totalBalance || 0}). Split payment is not allowed. Please proceed with online payment.`,
        400
      );
    }

    const payment = await prisma.payment.create({
      data: {
        razorpayOrderId: `mem_direct_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
        amount: 0,
        currency: 'INR',
        status: 'SUCCESS',
        customerId,
      },
    });

    const booking = await createBookingAndClearCart(
      customerId,
      payment,
      0,
      originalServiceTotal,
      true
    );

    res.json(
      new AppResponse('Booking completed successfully using membership balance', {
        booking,
        payment,
        isZeroAmount: true,
        membershipUsed: originalServiceTotal,
        pointsUsed: 0,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to complete booking with membership', {}, statusCode));
  }
};

/**
 * POST /api/payment/webhook
 * Razorpay Webhook Handler
 * Supports:
 *  - payment.captured
 *  - order.paid
 *  - payment.failed
 *  - refund.created / refund.processed
 * Handles both Booking payments and Membership purchases idempotently.
 */
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'] as string;

    if (!webhookSignature) {
      console.warn('[Razorpay Webhook] Missing x-razorpay-signature header');
      res.status(400).json({ error: 'Missing x-razorpay-signature header' });
      return;
    }

    const rawBody = (req as any).rawBody
      ? (req as any).rawBody.toString('utf8')
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    try {
      const isValid = Razorpay.validateWebhookSignature(
        rawBody,
        webhookSignature,
        RAZORPAY_WEBHOOK_SECRET
      );

      if (!isValid) {
        console.warn('[Razorpay Webhook] Signature verification failed');
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
      }
    } catch (sigErr: any) {
      console.warn('[Razorpay Webhook] Signature validation error:', sigErr.message);
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }

    const payload = req.body;
    const event = payload?.event;
    console.log(`[Razorpay Webhook] Processing event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payload?.payment?.entity;
      const orderEntity = payload.payload?.order?.entity;

      const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
      const razorpayPaymentId = paymentEntity?.id;

      if (!razorpayOrderId) {
        console.warn('[Razorpay Webhook] Order ID missing from payload');
        res.status(200).json({ status: 'ok', message: 'No order ID in payload' });
        return;
      }

      // Fetch payment record from database
      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId },
        include: {
          booking: true,
          customer: true,
        },
      });

      if (!payment) {
        console.warn(`[Razorpay Webhook] Payment record not found for orderId: ${razorpayOrderId}`);
        res.status(200).json({ status: 'ok', message: 'Payment record not found' });
        return;
      }

      // Extract notes, with fallback to fetching order details from Razorpay if notes are empty
      let notes: Record<string, any> = paymentEntity?.notes || orderEntity?.notes || {};
      if (!notes || Object.keys(notes).length === 0) {
        try {
          const fetchedOrder: any = await razorpay.orders.fetch(razorpayOrderId);
          notes = fetchedOrder.notes || {};
        } catch (fetchErr: any) {
          console.warn('[Razorpay Webhook] Could not fetch order notes from Razorpay:', fetchErr.message);
        }
      }

      // Map payment method to PaymentMode enum
      let paymentMode: PaymentMode = PaymentMode.UPI;
      const method = (paymentEntity?.method || '').toLowerCase();
      if (method === 'card') {
        paymentMode = PaymentMode.CARD;
      } else if (method === 'netbanking') {
        paymentMode = PaymentMode.BANK_TRANSFER;
      } else if (method === 'upi') {
        paymentMode = PaymentMode.UPI;
      }

      // 1. Membership order detection
      const planId = notes.planId;
      if (planId) {
        if (payment.status !== 'SUCCESS') {
          const isRenewal = notes.isRenewal === 'true' || notes.isRenewal === true;
          try {
            await activateMembershipPayment({
              customerId: payment.customerId,
              planId: String(planId),
              isRenewal,
              razorpayOrderId,
              razorpayPaymentId: razorpayPaymentId || payment.razorpayPaymentId || undefined,
              razorpaySignature: webhookSignature,
              skipSignatureCheck: true,
            });
            console.log(`[Razorpay Webhook] Successfully activated membership for customer ${payment.customerId}`);
          } catch (memErr: any) {
            console.error('[Razorpay Webhook] Error activating membership:', memErr.message || memErr);
          }
        } else {
          console.log(`[Razorpay Webhook] Membership payment for order ${razorpayOrderId} already marked SUCCESS`);
        }
      } else {
        // 2. Service / Package Booking order
        let updatedPayment = payment;
        if (payment.status !== 'SUCCESS') {
          updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'SUCCESS',
              razorpayPaymentId: razorpayPaymentId || payment.razorpayPaymentId,
              razorpaySignature: webhookSignature,
            },
            include: {
              booking: true,
              customer: true,
            },
          });
        }

        // Only create booking if one does not exist for this payment
        if (!updatedPayment.booking) {
          const existingBooking = await prisma.booking.findUnique({
            where: { paymentId: payment.id },
          });

          if (!existingBooking) {
            const pointsToUse = Number(notes.pointsToUse) || 0;
            try {
              await createBookingAndClearCart(
                payment.customerId,
                updatedPayment,
                pointsToUse,
                0,
                false,
                paymentMode
              );
              console.log(`[Razorpay Webhook] Successfully created booking for payment ${payment.id}`);
            } catch (bookingErr: any) {
              console.error('[Razorpay Webhook] Booking auto-creation notice:', bookingErr.message || bookingErr);
            }
          } else {
            console.log(`[Razorpay Webhook] Booking already exists for payment ${payment.id}`);
          }
        }
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payload?.payment?.entity;
      const razorpayOrderId = paymentEntity?.order_id;
      if (razorpayOrderId) {
        await prisma.payment.updateMany({
          where: {
            razorpayOrderId,
            status: 'PENDING',
          },
          data: {
            status: 'FAILED',
            razorpayPaymentId: paymentEntity?.id || undefined,
          },
        });
        console.log(`[Razorpay Webhook] Marked payment as FAILED for order ${razorpayOrderId}`);
      }
    } else if (event === 'refund.created' || event === 'refund.processed') {
      const refundEntity = payload.payload?.refund?.entity;
      const paymentEntity = payload.payload?.payment?.entity;
      const razorpayPaymentId = refundEntity?.payment_id || paymentEntity?.id;
      const razorpayOrderId = paymentEntity?.order_id;

      if (razorpayOrderId || razorpayPaymentId) {
        const payment = await prisma.payment.findFirst({
          where: {
            OR: [
              razorpayOrderId ? { razorpayOrderId } : undefined,
              razorpayPaymentId ? { razorpayPaymentId } : undefined,
            ].filter(Boolean) as any,
          },
          include: { booking: true },
        });

        if (payment) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'REFUNDED' },
          });

          if (payment.booking) {
            await prisma.booking.update({
              where: { id: payment.booking.id },
              data: { paymentStatus: 'REFUNDED' },
            });
          }
          console.log(`[Razorpay Webhook] Marked payment & booking as REFUNDED for order ${payment.razorpayOrderId}`);
        }
      }
    } else {
      console.log(`[Razorpay Webhook] Unhandled event received: ${event}`);
    }

    res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error('[Razorpay Webhook] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error processing webhook' });
  }
};

import { Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } from '../../configs/env';
import { generateOrGetInvoiceForBooking } from '../invoice/invoiceService';

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

  for (const item of items) {
    const itemPrice = item.price || item.service?.discountPrice || item.service?.price || item.package?.discountPrice || item.package?.price || 0;
    subtotal += itemPrice;
  }

  let discount = 0;
  if (cart.couponCode) {
    const offer = await prisma.offer.findFirst({
      where: {
        couponCode: { equals: cart.couponCode, mode: 'insensitive' },
        isActive: true,
      },
    });

    if (offer) {
      if (offer.discountType === 'PERCENTAGE') {
        discount = (subtotal * offer.discountValue) / 100;
      } else if (offer.discountType === 'FIXED') {
        discount = offer.discountValue;
      }
    }
  }

  discount = Math.min(discount, subtotal);
  return { subtotal, couponDiscount: discount };
}

/**
 * Shared Helper: Create Booking from Cart & Clear Cart
 */
export async function createBookingAndClearCart(customerId: string, payment: any, pointsToUse: number = 0) {
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
    const existingBooking = await prisma.booking.findUnique({
      where: { paymentId: payment.id },
      include: { items: { include: { service: true, package: true, staff: true } } },
    });
    if (existingBooking) return existingBooking;
    throw new AppError('Cart is empty', 400);
  }

  const { subtotal, couponDiscount } = await getCartTotalAndDiscount(cart);
  const actualPointsUsed = Math.min(Math.max(0, pointsToUse), customer.points);
  const finalDiscount = couponDiscount + actualPointsUsed;
  const totalAmount = Math.max(0, subtotal - finalDiscount);
  const pointsEarned = Math.round(totalAmount * 0.01);

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

  // Use transaction to create Booking, BookingItems, update Customer points, clear Cart
  const booking = await prisma.$transaction(async (tx) => {
    // Create Booking
    const newBooking = await tx.booking.create({
      data: {
        bookingNumber,
        customerId,
        saloonId,
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
        subtotal,
        discount: finalDiscount,
        totalAmount,
        pointsUsed: actualPointsUsed,
        pointsEarned,
        couponCode: cart.couponCode || '',
        paymentId: payment.id,
        items: {
          create: cart.items.map((item) => ({
            serviceId: item.serviceId,
            packageId: item.packageId,
            staffId: item.staffId,
            date: item.date || '',
            timeSlot: item.timeSlot || '',
            price: item.price,
          })),
        },
      },
      include: {
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
        },
        saloon: true,
      },
    });

    // Update Customer points
    const newPointsBalance = Math.max(0, customer.points - actualPointsUsed + pointsEarned);
    await tx.customer.update({
      where: { id: customerId },
      data: { points: newPointsBalance },
    });

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

  // Automatically generate invoice upon booking & payment completion
  try {
    await generateOrGetInvoiceForBooking(booking.id);
  } catch (invErr) {
    console.error('Failed to auto-generate invoice:', invErr);
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

    const { pointsToUse = 0 } = req.body;

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
          include: { service: true, package: true },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError('Your cart is empty', 400);
    }

    const { subtotal, couponDiscount } = await getCartTotalAndDiscount(cart);
    const validPointsToUse = Math.min(Math.max(0, pointsToUse), customer.points);
    const finalTotal = Math.max(0, subtotal - couponDiscount - validPointsToUse);
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
        couponCode: cart.couponCode,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to create payment order', {}, statusCode));
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

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, pointsToUse = 0 } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId) {
      throw new AppError('Missing payment details', 400);
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
    });

    if (!payment) {
      throw new AppError('Payment record not found', 404);
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

    // Create booking and clear cart
    const booking = await createBookingAndClearCart(customerId, updatedPayment, pointsToUse);

    res.json(
      new AppResponse('Payment verified and booking created successfully', {
        booking,
        payment: updatedPayment,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to verify payment and create booking', {}, statusCode));
  }
};

/**
 * POST /api/payment/webhook
 * Razorpay Webhook Handler
 */
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (RAZORPAY_WEBHOOK_SECRET && webhookSignature) {
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

      if (expectedSignature !== webhookSignature) {
        console.warn('Webhook signature verification failed');
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
      }
    }

    const payload = req.body;
    const event = payload?.event;

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payload?.payment?.entity;
      const razorpayOrderId = paymentEntity?.order_id || payload.payload?.order?.entity?.id;
      const razorpayPaymentId = paymentEntity?.id;

      if (razorpayOrderId) {
        const payment = await prisma.payment.findUnique({
          where: { razorpayOrderId },
        });

        if (payment && payment.status !== 'SUCCESS') {
          const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'SUCCESS',
              razorpayPaymentId: razorpayPaymentId || payment.razorpayPaymentId,
            },
          });

          // Automatically create booking if client didn't complete verification yet
          await createBookingAndClearCart(payment.customerId, updatedPayment, 0);
        }
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payload?.payment?.entity;
      const razorpayOrderId = paymentEntity?.order_id;
      if (razorpayOrderId) {
        await prisma.payment.updateMany({
          where: { razorpayOrderId },
          data: { status: 'FAILED' },
        });
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error processing webhook' });
  }
};

import { Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { getPagination, getPaginationMeta } from '../../utils/pagination';
import { getCustomerMembershipSummary, activateMembershipPayment } from './membershipService';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from '../../configs/env';

// Initialize Razorpay client instance
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

/**
 * GET /api/membership
 * Admin: List memberships with pagination, search, and status filter
 */
export const getMemberships = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search = '', status = 'ALL' } = req.query;
    const paginationParams = getPagination(req, 20);

    const where: any = {};
    const now = new Date();

    // Status filtering
    if (status === 'ACTIVE') {
      where.isActive = true;
      where.balance = { gt: 0 };
      where.OR = [
        { endDate: null },
        { endDate: { gte: now } },
      ];
    } else if (status === 'EXPIRED') {
      where.endDate = { lt: now };
    } else if (status === 'EXHAUSTED') {
      where.balance = 0;
    }

    // Search filter across customer name, phone, email
    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim();
      where.customer = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const [memberships, total] = await Promise.all([
      prisma.membership.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: paginationParams.offset,
        take: paginationParams.limit,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              points: true,
            },
          },
          _count: {
            select: { transactions: true },
          },
        },
      }),
      prisma.membership.count({ where }),
    ]);

    const paginationMeta = getPaginationMeta(total, paginationParams);

    res.json(new AppResponse('Memberships retrieved successfully', memberships, 200, paginationMeta));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve memberships', {}, statusCode));
  }
};

/**
 * POST /api/membership
 * Admin: Create / Provide a membership for a customer
 * Body: { customerId, amount, value, endDate?, note? }
 */
export const createMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, amount, value, endDate, note } = req.body;

    if (!customerId) {
      throw new AppError('Customer ID is required', 400);
    }

    const numAmount = Number(amount);
    const numValue = Number(value);

    if (isNaN(numAmount) || numAmount < 0) {
      throw new AppError('Valid amount is required', 400);
    }

    if (isNaN(numValue) || numValue <= 0) {
      throw new AppError('Valid membership benefit value is required', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    let parsedEndDate: Date | null = null;
    if (endDate && typeof endDate === 'string' && endDate.trim() !== '') {
      parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) {
        throw new AppError('Invalid ending date format', 400);
      }
    }

    // Create Membership & Initial Credit Transaction
    const membership = await prisma.$transaction(async (tx) => {
      const newMembership = await tx.membership.create({
        data: {
          customerId,
          amount: numAmount,
          initialValue: numValue,
          balance: numValue,
          startDate: new Date(),
          endDate: parsedEndDate,
          isActive: true,
          note: note || '',
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
        },
      });

      await tx.membershipTransaction.create({
        data: {
          membershipId: newMembership.id,
          type: 'CREDIT',
          amount: numValue,
          balanceBefore: 0,
          balanceAfter: numValue,
          note: `Membership issued. Paid ₹${numAmount} for ₹${numValue} value.`,
        },
      });

      return newMembership;
    });

    res.status(201).json(new AppResponse('Membership provided successfully', membership, 201));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to create membership', {}, statusCode));
  }
};

/**
 * GET /api/membership/:id
 * Admin: Get single membership with full transactions
 */
export const getMembershipById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const membership = await prisma.membership.findUnique({
      where: { id: String(id) },
      include: {
        customer: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          include: {
            booking: {
              select: {
                id: true,
                bookingNumber: true,
                totalAmount: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new AppError('Membership not found', 404);
    }

    res.json(new AppResponse('Membership details retrieved successfully', membership));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve membership', {}, statusCode));
  }
};

/**
 * PATCH /api/membership/:id
 * Admin: Update membership (endDate, isActive, note, or add top-up value)
 */
export const updateMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { endDate, isActive, note, addBalance } = req.body;

    const existing = await prisma.membership.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Membership not found', 404);
    }

    const updateData: any = {};

    if (endDate !== undefined) {
      if (endDate === null || endDate === '') {
        updateData.endDate = null;
      } else {
        const parsed = new Date(endDate);
        if (isNaN(parsed.getTime())) {
          throw new AppError('Invalid date format', 400);
        }
        updateData.endDate = parsed;
      }
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    if (note !== undefined) {
      updateData.note = String(note);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Optional top-up
      if (addBalance && Number(addBalance) > 0) {
        const topUp = Number(addBalance);
        const newBalance = existing.balance + topUp;
        updateData.balance = newBalance;
        updateData.initialValue = existing.initialValue + topUp;

        await tx.membershipTransaction.create({
          data: {
            membershipId: existing.id,
            type: 'CREDIT',
            amount: topUp,
            balanceBefore: existing.balance,
            balanceAfter: newBalance,
            note: 'Balance top-up added by admin',
          },
        });
      }

      return tx.membership.update({
        where: { id: String(id) },
        data: updateData,
        include: {
          customer: true,
          transactions: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });

    res.json(new AppResponse('Membership updated successfully', updated));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to update membership', {}, statusCode));
  }
};

/**
 * DELETE /api/membership/:id
 * Admin: Delete or cancel membership
 */
export const deleteMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await prisma.membership.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Membership not found', 404);
    }

    await prisma.membership.delete({
      where: { id: String(id) },
    });

    res.json(new AppResponse('Membership deleted successfully', { id }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to delete membership', {}, statusCode));
  }
};

/**
 * GET /api/membership/customer/:customerId
 * Admin: Get all memberships for a specific customer
 */
export const getCustomerMemberships = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId } = req.params;

    const memberships = await prisma.membership.findMany({
      where: { customerId: String(customerId) },
      orderBy: { createdAt: 'desc' },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const summary = await getCustomerMembershipSummary(String(customerId));

    res.json(new AppResponse('Customer memberships retrieved successfully', {
      summary,
      memberships,
    }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve customer memberships', {}, statusCode));
  }
};

/**
 * GET /api/membership/my-membership
 * Customer: Get current logged-in customer's active membership status & balance
 */
export const getMyMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const summary = await getCustomerMembershipSummary(customerId);

    // Fetch recent usage transactions
    const recentTransactions = await prisma.membershipTransaction.findMany({
      where: {
        membership: { customerId },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            totalAmount: true,
            createdAt: true,
          },
        },
      },
    });

    res.json(
      new AppResponse('My membership status retrieved successfully', {
        ...summary,
        recentTransactions,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve membership status', {}, statusCode));
  }
};

/**
 * POST /api/memberships/purchase-order
 * Customer: Create a Razorpay order to take or renew a membership
 * Body: { planId: string, isRenewal?: boolean }
 */
export const createMembershipOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const { planId, isRenewal = false } = req.body;

    if (!planId || typeof planId !== 'string') {
      throw new AppError('Plan ID is required', 400);
    }

    // 1. Fetch Plan
    const plan = await prisma.membershipPlan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.isActive) {
      throw new AppError('Membership plan not found or currently inactive', 404);
    }

    // 2. Enforce strict renewal & active rules
    const summary = await getCustomerMembershipSummary(customerId);

    if (isRenewal) {
      if (!summary.canRenew) {
        throw new AppError(
          'Current membership is still active. Renewal is only permitted once current membership expires.',
          400
        );
      }
    } else {
      if (summary.hasMembership) {
        throw new AppError(
          'You already have an active VIP membership. You can renew once your current membership expires.',
          400
        );
      }
    }

    const amountInPaise = Math.round(plan.amount * 100);
    const receipt = `mem_rcpt_${Date.now()}`;
    let razorpayOrder: any;

    try {
      razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise > 0 ? amountInPaise : 100,
        currency: 'INR',
        receipt,
        notes: {
          customerId,
          planId: plan.id,
          planName: plan.name,
          isRenewal: String(Boolean(isRenewal)),
        },
      });
    } catch (rzpErr: any) {
      console.warn('Razorpay API error, generating mock order for dev testing:', rzpErr.message);
      razorpayOrder = {
        id: `order_mock_mem_${Date.now()}`,
        amount: amountInPaise,
        currency: 'INR',
        receipt,
      };
    }

    // Save Payment record in DB with customer association
    const payment = await prisma.payment.create({
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: plan.amount,
        currency: 'INR',
        status: 'PENDING',
        customerId,
      },
    });

    res.json(
      new AppResponse('Membership payment order created successfully', {
        orderId: razorpayOrder.id,
        paymentId: payment.id,
        amount: plan.amount,
        amountInPaise,
        currency: 'INR',
        keyId: RAZORPAY_KEY_ID,
        plan: {
          id: plan.id,
          name: plan.name,
          tagline: plan.tagline,
          amount: plan.amount,
          benefitValue: plan.benefitValue,
          validityMonths: plan.validityMonths,
        },
        isRenewal: Boolean(isRenewal),
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to create membership order', {}, statusCode));
  }
};

/**
 * POST /api/memberships/verify-and-activate
 * Customer: Verify payment signature and activate / renew membership
 * Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature, planId, isRenewal?: boolean }
 */
export const verifyAndActivateMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      planId,
      isRenewal = false,
    } = req.body;

    if (!razorpayOrderId || !planId) {
      throw new AppError('Missing required payment verification details', 400);
    }

    const result = await activateMembershipPayment({
      customerId,
      planId: String(planId),
      isRenewal: Boolean(isRenewal),
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    res.status(201).json(
      new AppResponse(
        isRenewal
          ? 'Membership renewed successfully!'
          : 'Welcome! Membership activated successfully.',
        {
          membership: result.newMembership,
          payment: result.updatedPayment,
          summary: result.summary,
        },
        201
      )
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to verify and activate membership', {}, statusCode));
  }
};

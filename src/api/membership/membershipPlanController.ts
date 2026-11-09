import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';

/**
 * GET /api/memberships/plans
 * Public / Customer: Get active membership plans sorted by orderNo
 */
export const getPublicPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = await prisma.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: [{ orderNo: 'asc' }, { amount: 'asc' }],
    });

    res.json(new AppResponse('Membership plans retrieved successfully', plans));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve membership plans', {}, statusCode));
  }
};

/**
 * GET /api/memberships/admin/plans
 * Admin: Get all membership plans (active & inactive)
 */
export const getAdminPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = await prisma.membershipPlan.findMany({
      orderBy: [{ orderNo: 'asc' }, { createdAt: 'desc' }],
    });
    res.json(new AppResponse('Admin membership plans retrieved successfully', plans));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve admin plans', {}, statusCode));
  }
};

/**
 * POST /api/memberships/admin/plans
 * Admin: Create a new membership plan
 */
export const createPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      tagline = '',
      description = '',
      amount,
      benefitValue,
      validityMonths = 12,
      features = [],
      isPopular = false,
      isActive = true,
      orderNo = 0,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new AppError('Plan name is required', 400);
    }

    const numAmount = Number(amount);
    const numValue = Number(benefitValue);
    const numValidity = Number(validityMonths);

    if (isNaN(numAmount) || numAmount <= 0) {
      throw new AppError('Valid plan amount is required (greater than 0)', 400);
    }

    if (isNaN(numValue) || numValue <= 0) {
      throw new AppError('Valid benefit value is required (greater than 0)', 400);
    }

    if (isNaN(numValidity) || numValidity < 0) {
      throw new AppError('Validity months must be 0 (lifetime) or positive number', 400);
    }

    const plan = await prisma.membershipPlan.create({
      data: {
        name: name.trim(),
        tagline: typeof tagline === 'string' ? tagline.trim() : '',
        description: typeof description === 'string' ? description.trim() : '',
        amount: numAmount,
        benefitValue: numValue,
        validityMonths: numValidity,
        features: Array.isArray(features) ? features.filter((f) => typeof f === 'string' && f.trim() !== '') : [],
        isPopular: Boolean(isPopular),
        isActive: Boolean(isActive),
        orderNo: Number(orderNo) || 0,
      },
    });

    res.status(201).json(new AppResponse('Membership plan created successfully', plan, 201));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to create membership plan', {}, statusCode));
  }
};

/**
 * PATCH /api/memberships/admin/plans/:id
 * Admin: Update an existing membership plan
 */
export const updatePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.membershipPlan.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Membership plan not found', 404);
    }

    const {
      name,
      tagline,
      description,
      amount,
      benefitValue,
      validityMonths,
      features,
      isPopular,
      isActive,
      orderNo,
    } = req.body;

    const updateData: any = {};

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || name.trim() === '') {
        throw new AppError('Plan name cannot be empty', 400);
      }
      updateData.name = name.trim();
    }

    if (tagline !== undefined) updateData.tagline = String(tagline).trim();
    if (description !== undefined) updateData.description = String(description).trim();

    if (amount !== undefined) {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new AppError('Valid plan amount is required', 400);
      }
      updateData.amount = numAmount;
    }

    if (benefitValue !== undefined) {
      const numValue = Number(benefitValue);
      if (isNaN(numValue) || numValue <= 0) {
        throw new AppError('Valid benefit value is required', 400);
      }
      updateData.benefitValue = numValue;
    }

    if (validityMonths !== undefined) {
      const numVal = Number(validityMonths);
      if (isNaN(numVal) || numVal < 0) {
        throw new AppError('Validity months must be 0 (lifetime) or positive', 400);
      }
      updateData.validityMonths = numVal;
    }

    if (features !== undefined) {
      updateData.features = Array.isArray(features)
        ? features.filter((f) => typeof f === 'string' && f.trim() !== '')
        : [];
    }

    if (isPopular !== undefined) updateData.isPopular = Boolean(isPopular);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (orderNo !== undefined) updateData.orderNo = Number(orderNo) || 0;

    const updated = await prisma.membershipPlan.update({
      where: { id: String(id) },
      data: updateData,
    });

    res.json(new AppResponse('Membership plan updated successfully', updated));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to update membership plan', {}, statusCode));
  }
};

/**
 * PATCH /api/memberships/admin/plans/:id/toggle
 * Admin: Quick toggle active status
 */
export const togglePlanActive = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.membershipPlan.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Membership plan not found', 404);
    }

    const updated = await prisma.membershipPlan.update({
      where: { id: String(id) },
      data: { isActive: !existing.isActive },
    });

    res.json(
      new AppResponse(
        `Membership plan ${updated.isActive ? 'activated' : 'deactivated'} successfully`,
        updated
      )
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to toggle membership plan', {}, statusCode));
  }
};

/**
 * DELETE /api/memberships/admin/plans/:id
 * Admin: Delete a membership plan
 */
export const deletePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.membershipPlan.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Membership plan not found', 404);
    }

    await prisma.membershipPlan.delete({
      where: { id: String(id) },
    });

    res.json(new AppResponse('Membership plan deleted successfully', { id }));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to delete membership plan', {}, statusCode));
  }
};


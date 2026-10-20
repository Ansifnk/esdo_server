import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

/**
 * GET /api/customer
 * Search / List customers for Admin
 */
export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search = '' } = req.query;
    const paginationParams = getPagination(req, 20);

    const whereCondition: any = {};
    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim();
      whereCondition.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rawCustomers, total] = await Promise.all([
      prisma.customer.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' },
        skip: paginationParams.offset,
        take: paginationParams.limit,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          birthDate: true,
          address: true,
          points: true,
          referralCode: true,
          defaultSaloonId: true,
          defaultSaloon: true,
          rewardTransactions: {
            where: {
              status: 'ACTIVE',
              remainingCoins: { gt: 0 },
            },
            select: {
              type: true,
              remainingCoins: true,
            },
          },
          createdAt: true,
        },
      }),
      prisma.customer.count({ where: whereCondition }),
    ]);

    const customers = rawCustomers.map((c) => {
      let rewardPoints = 0;
      let referralPoints = 0;
      for (const tx of c.rewardTransactions || []) {
        if (tx.type === 'SPEND_EARN') rewardPoints += tx.remainingCoins;
        else if (tx.type === 'REFERRAL_EARN') referralPoints += tx.remainingCoins;
      }
      const totalPoints = c.points || 0;
      if (rewardPoints + referralPoints < totalPoints) {
        rewardPoints += (totalPoints - (rewardPoints + referralPoints));
      }

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        birthDate: c.birthDate,
        address: c.address || '',
        points: totalPoints,
        rewardPoints,
        referralPoints,
        referralCode: c.referralCode,
        defaultSaloonId: c.defaultSaloonId,
        defaultSaloon: c.defaultSaloon,
        saloonId: c.defaultSaloonId,
        saloon: c.defaultSaloon,
        createdAt: c.createdAt,
      };
    });

    const paginationMeta = getPaginationMeta(total, paginationParams);

    res.json(new AppResponse('Customers retrieved successfully', customers, 200, paginationMeta));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve customers', {}, statusCode));
  }
};

/**
 * POST /api/customer
 * Create a new customer (Admin)
 */
export const createCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, phone, email, birthDate, address } = req.body;

    const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
    let parsedBirthDate: Date | null = null;
    if (birthDate) {
      const d = new Date(birthDate);
      if (!isNaN(d.getTime())) {
        parsedBirthDate = d;
      }
    }
    const cleanAddress = address && typeof address === 'string' && address.trim() !== '' ? address.trim() : null;

    if (!name && !phone && !cleanEmail) {
      throw new AppError('Please provide at least a customer name, phone number, or email.', 400);
    }

    if (phone) {
      const existing = await prisma.customer.findUnique({ where: { phone } });
      if (existing) {
        throw new AppError('A customer with this phone number already exists.', 400);
      }
    }

    if (cleanEmail) {
      const existing = await prisma.customer.findUnique({ where: { email: cleanEmail } });
      if (existing) {
        throw new AppError('A customer with this email address already exists.', 400);
      }
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name: name || 'Walk-in Customer',
        phone: phone || null,
        email: cleanEmail,
        birthDate: parsedBirthDate,
        address: cleanAddress,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        birthDate: true,
        address: true,
        points: true,
        createdAt: true,
      },
    });

    res.status(201).json(new AppResponse('Customer created successfully', newCustomer, 201));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to create customer', {}, statusCode));
  }
};

/**
 * PATCH /api/customer/branch
 * Update logged-in customer's preferred branch / saloon
 */
export const updateCustomerBranch = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const targetSaloonId = req.body.defaultSaloonId || req.body.saloonId;
    if (!targetSaloonId) {
      throw new AppError('Branch (defaultSaloonId) is required', 400);
    }

    // Verify saloon exists
    const saloon = await prisma.saloon.findUnique({
      where: { id: targetSaloonId },
    });
    if (!saloon) {
      throw new AppError('Selected branch not found', 404);
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: { defaultSaloonId: targetSaloonId },
      include: { defaultSaloon: true },
    });

    const { password: _, ...customerData } = updatedCustomer;
    res.json(new AppResponse('Branch updated successfully', {
      ...customerData,
      saloonId: updatedCustomer.defaultSaloonId,
      saloon: updatedCustomer.defaultSaloon,
    }, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to update branch', {}, statusCode));
  }
};

/**
 * PATCH /api/customer/profile
 * Update logged-in customer's profile (name, email, birthDate, address)
 * Phone number cannot be edited here as per requirement.
 */
export const updateCustomerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const { name, email, birthDate, address } = req.body;

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const updateData: any = {};

    if (name !== undefined) {
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName) {
        throw new AppError('Name cannot be empty', 400);
      }
      updateData.name = cleanName;
    }

    if (email !== undefined) {
      const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
      if (cleanEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new AppError('Please enter a valid email address', 400);
        }
        if (cleanEmail !== customer.email) {
          const existing = await prisma.customer.findUnique({
            where: { email: cleanEmail },
          });
          if (existing && existing.id !== customerId) {
            throw new AppError('This email is already in use by another account', 400);
          }
        }
      }
      updateData.email = cleanEmail;
    }

    if (birthDate !== undefined) {
      if (!birthDate) {
        updateData.birthDate = null;
      } else {
        const d = new Date(birthDate);
        if (isNaN(d.getTime())) {
          throw new AppError('Please enter a valid birth date', 400);
        }
        if (d >= new Date()) {
          throw new AppError('Birth date must be in the past', 400);
        }
        updateData.birthDate = d;
      }
    }

    if (address !== undefined) {
      updateData.address = typeof address === 'string' ? address.trim() || null : null;
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
      include: { defaultSaloon: true },
    });

    const { password: _, ...customerData } = updatedCustomer;
    res.json(new AppResponse('Profile updated successfully', {
      ...customerData,
      saloonId: updatedCustomer.defaultSaloonId,
      saloon: updatedCustomer.defaultSaloon,
      address: updatedCustomer.address || '',
    }, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to update profile', {}, statusCode));
  }
};

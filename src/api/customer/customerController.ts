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
          points: true,
          referralCode: true,
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
        points: totalPoints,
        rewardPoints,
        referralPoints,
        referralCode: c.referralCode,
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
    const { name, phone, email } = req.body;

    if (!name && !phone && !email) {
      throw new AppError('Please provide at least a customer name, phone number, or email.', 400);
    }

    if (phone) {
      const existing = await prisma.customer.findUnique({ where: { phone } });
      if (existing) {
        throw new AppError('A customer with this phone number already exists.', 400);
      }
    }

    if (email) {
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (existing) {
        throw new AppError('A customer with this email address already exists.', 400);
      }
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name: name || 'Walk-in Customer',
        phone: phone || null,
        email: email || null,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
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

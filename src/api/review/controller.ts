import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const getReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.query.serviceId as string;
    const saloonId = req.query.saloonId as string;

    const where: any = {};
    if (serviceId) {
      where.serviceId = serviceId;
    }
    if (saloonId) {
      where.saloonId = saloonId;
    }

    const pagination = getPagination(req);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.review.count({ where }),
    ]);

    // Calculate average rating
    const avgResult = await prisma.review.aggregate({
      where,
      _avg: {
        rating: true,
      },
    });

    const meta = {
      ...getPaginationMeta(total, pagination),
      averageRating: avgResult._avg.rating ? Math.round(avgResult._avg.rating * 10) / 10 : 0,
    };

    res.json(new AppResponse('Reviews retrieved successfully', reviews, 200, meta));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Failed to fetch reviews', [], status));
  }
};

export const createReview = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('rating').isFloat({ min: 1, max: 5 }).withMessage('Rating must be a number between 1 and 5').run(req);
    await body('comment').trim().notEmpty().withMessage('Comment is required').run(req);
    await body('serviceId').optional().isString().withMessage('Service ID must be a string').run(req);
    await body('saloonId').optional().isString().withMessage('Saloon ID must be a string').run(req);
    await body('userName').optional().isString().withMessage('User name must be a string').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { serviceId, saloonId: bodySaloonId, rating, comment, userName } = req.body;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Authentication required', {}, 401));
      return;
    }

    let saloonId = bodySaloonId;

    // If serviceId is provided but saloonId is not, attempt to fetch saloonId from service
    if (serviceId && !saloonId) {
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        select: { saloonId: true },
      });
      if (service) {
        saloonId = service.saloonId;
      }
    }

    const isCustomer = user.roles.some((r: any) => r.role === Role.CUSTOMER);
    const customerId = isCustomer ? user.id : undefined;
    const userId = !isCustomer ? user.id : undefined;

    const displayName = userName?.trim() || user.name || (isCustomer ? 'Customer' : 'User');

    const review = await prisma.review.create({
      data: {
        serviceId: serviceId || null,
        saloonId: saloonId || null,
        customerId: customerId || null,
        userId: userId || null,
        rating: Number(rating),
        comment: comment.trim(),
        userName: displayName,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    res.json(new AppResponse('Review submitted successfully', review, 201));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Failed to submit review', {}, status));
  }
};

export const getReviewById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid review ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        customer: true,
        user: true,
        service: true,
        saloon: true,
      },
    });

    if (!review) {
      res.json(new AppResponse('Review not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Review retrieved successfully', review, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const deleteReview = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid review ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const user = req.user;

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      res.json(new AppResponse('Review not found', {}, 404));
      return;
    }

    const isSuperAdmin = user?.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user?.roles.some((r: any) => r.role === Role.ADMIN);
    const isOwner = user?.id === review.customerId || user?.id === review.userId;

    if (!isSuperAdmin && !isAdmin && !isOwner) {
      res.json(new AppResponse('Unauthorized to delete this review', {}, 403));
      return;
    }

    await prisma.review.delete({ where: { id } });

    res.json(new AppResponse('Review deleted successfully', {}, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const getReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceId = req.query.serviceId as string;
    const staffId = req.query.staffId as string;
    const bookingId = req.query.bookingId as string;
    const saloonId = req.query.saloonId as string;

    const where: any = {};
    if (serviceId) {
      where.serviceId = serviceId;
    }
    if (staffId) {
      where.staffId = staffId;
    }
    if (bookingId) {
      where.bookingId = bookingId;
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
              phone: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          staff: {
            select: {
              id: true,
              name: true,
              image: true,
              stylistCategory: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
            },
          },
          saloon: {
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
      totalReviews: total,
    };

    res.json(new AppResponse('Reviews retrieved successfully', reviews, 200, meta));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Failed to fetch reviews', [], status));
  }
};

export const syncStaffReviewStats = async (
  staffId: string,
  tx?: Prisma.TransactionClient
): Promise<void> => {
  try {
    const client = tx || prisma;
    const stats = await client.review.aggregate({
      where: { staffId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const avgRating = stats._avg.rating ? Math.round(stats._avg.rating * 10) / 10 : 0;
    const ratingCount = stats._count._all;

    await client.staff.update({
      where: { id: staffId },
      data: {
        avgRating,
        ratingCount,
      },
    });
  } catch (err) {
    console.error('Failed to sync staff review stats:', err);
    throw err;
  }
};

export const syncServiceReviewStats = async (
  serviceId: string,
  tx?: Prisma.TransactionClient
): Promise<void> => {
  try {
    const client = tx || prisma;
    const stats = await client.review.aggregate({
      where: { serviceId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const avgRating = stats._avg.rating ? Math.round(stats._avg.rating * 10) / 10 : 0;
    const ratingCount = stats._count._all;

    await client.service.update({
      where: { id: serviceId },
      data: {
        avgRating,
        ratingCount,
      },
    });
  } catch (err) {
    console.error('Failed to sync service review stats:', err);
    throw err;
  }
};

export const createReview = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('rating').isFloat({ min: 1, max: 5 }).withMessage('Rating must be a number between 1 and 5').run(req);
    await body('comment').trim().notEmpty().withMessage('Comment is required').run(req);
    await body('serviceId').optional().isString().withMessage('Service ID must be a string').run(req);
    await body('staffId').optional().isString().withMessage('Staff ID must be a string').run(req);
    await body('bookingId').optional().isString().withMessage('Booking ID must be a string').run(req);
    await body('saloonId').optional().isString().withMessage('Saloon ID must be a string').run(req);
    await body('userName').optional().isString().withMessage('User name must be a string').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { serviceId, staffId, bookingId, saloonId: bodySaloonId, rating, comment, userName } = req.body;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Authentication required', {}, 401));
      return;
    }

    let saloonId = bodySaloonId;

    // If staffId is provided but saloonId is not, fetch saloonId from staff
    if (staffId && !saloonId) {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { saloonId: true },
      });
      if (staff) {
        saloonId = staff.saloonId;
      }
    }

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

    const displayName = userName?.trim() || user.name || (isCustomer ? 'Customer' : 'Verified Client');

    // Customer specific checks for completed bookings
    if (isCustomer && bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { items: true },
      });

      if (!booking) {
        res.json(new AppResponse('Booking not found', {}, 404));
        return;
      }

      if (booking.customerId !== customerId) {
        res.json(new AppResponse('Unauthorized: This booking does not belong to you', {}, 403));
        return;
      }

      if (booking.status !== 'COMPLETED') {
        res.json(new AppResponse('Reviews can only be submitted after the service has been completed', {}, 400));
        return;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // If customer and bookingId, acquire row lock on Booking to serialize concurrent submissions and prevent duplicate reviews
      if (isCustomer && bookingId) {
        await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;

        // Check if a review already exists for this booking + staff/service
        const existingReview = await tx.review.findFirst({
          where: {
            bookingId,
            customerId,
            ...(staffId ? { staffId } : serviceId ? { serviceId } : {}),
          },
        });

        if (existingReview) {
          const updated = await tx.review.update({
            where: { id: existingReview.id },
            data: {
              rating: Number(rating),
              comment: comment.trim(),
              userName: displayName,
            },
            include: {
              customer: { select: { id: true, name: true } },
              staff: { select: { id: true, name: true, image: true } },
              service: { select: { id: true, name: true } },
            },
          });

          const targetStaffId = updated.staffId || staffId;
          if (targetStaffId) {
            await syncStaffReviewStats(targetStaffId, tx);
          }
          const targetServiceId = updated.serviceId || serviceId;
          if (targetServiceId) {
            await syncServiceReviewStats(targetServiceId, tx);
          }

          return { isUpdated: true, review: updated };
        }
      }

      const review = await tx.review.create({
        data: {
          serviceId: serviceId || null,
          staffId: staffId || null,
          bookingId: bookingId || null,
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
          staff: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (review.staffId) {
        await syncStaffReviewStats(review.staffId, tx);
      }
      if (review.serviceId) {
        await syncServiceReviewStats(review.serviceId, tx);
      }

      return { isUpdated: false, review };
    });

    if (result.isUpdated) {
      res.json(new AppResponse('Review updated successfully', result.review, 200));
    } else {
      res.json(new AppResponse('Review submitted successfully', result.review, 201));
    }
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
        staff: true,
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

    await prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id } });

      if (review.staffId) {
        await syncStaffReviewStats(review.staffId, tx);
      }
      if (review.serviceId) {
        await syncServiceReviewStats(review.serviceId, tx);
      }
    });

    res.json(new AppResponse('Review deleted successfully', {}, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

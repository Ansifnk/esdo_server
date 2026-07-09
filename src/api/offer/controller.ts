import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role, OfferType, DiscountType } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createOffer = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('type').isIn(Object.values(OfferType)).withMessage('Invalid offer type').run(req);
    await body('description').optional().trim().run(req);
    await body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').run(req);
    await body('startDate').optional().isISO8601().withMessage('Invalid start date').run(req);
    await body('endDate').optional().isISO8601().withMessage('Invalid end date').run(req);
    await body('serviceIds').optional().isArray().withMessage('serviceIds must be an array of UUIDs').run(req);
    await body('packageIds').optional().isArray().withMessage('packageIds must be an array of UUIDs').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const {
      name,
      description = '',
      type,
      bannerImage = '',
      couponCode = '',
      discountType = DiscountType.PERCENTAGE,
      discountValue = 0,
      isActive = true,
      startDate,
      endDate,
      serviceIds = [],
      packageIds = [],
    } = req.body;

    let saloonId = req.body.saloonId;

    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        // Saloon admins can only create offers for their own saloon
        saloonId = (user as any).saloonId;
        if (!saloonId) {
          res.json(new AppResponse('Forbidden: You are not assigned to a saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    // Conditional Validation based on Offer Type
    if (type === OfferType.BANNER) {
      if (!bannerImage) {
        res.json(new AppResponse('Banner image is required for banner offers', {}, 400));
        return;
      }
      if (discountValue !== undefined && Number(discountValue) < 0) {
        res.json(new AppResponse('Discount value must be a positive number', {}, 400));
        return;
      }
    } else if (type === OfferType.COUPON) {
      if (!couponCode) {
        res.json(new AppResponse('Coupon code is required for coupon offers', {}, 400));
        return;
      }
      if (!Object.values(DiscountType).includes(discountType)) {
        res.json(new AppResponse('Invalid discount type', {}, 400));
        return;
      }
      if (Number(discountValue) <= 0) {
        res.json(new AppResponse('Discount value must be a positive number', {}, 400));
        return;
      }
    }

    // Verify Saloon exists if saloonId is provided
    if (saloonId) {
      const saloonExists = await prisma.saloon.findUnique({
        where: { id: saloonId },
      });
      if (!saloonExists) {
        res.json(new AppResponse('Saloon not found', {}, 404));
        return;
      }
    }

    // Verify and scope services if target services are selected
    if (serviceIds.length > 0) {
      const uniqueServiceIds = [...new Set(serviceIds as string[])];
      const serviceWhere: any = { id: { in: uniqueServiceIds } };
      if (saloonId) {
        serviceWhere.saloonId = saloonId;
      }
      const count = await prisma.service.count({
        where: serviceWhere,
      });
      if (count !== uniqueServiceIds.length) {
        res.json(new AppResponse('One or more services are invalid or do not belong to the selected saloon', {}, 400));
        return;
      }
    }

    // Verify and scope packages if target packages are selected
    if (packageIds.length > 0) {
      const uniquePackageIds = [...new Set(packageIds as string[])];
      const packageWhere: any = { id: { in: uniquePackageIds } };
      if (saloonId) {
        packageWhere.saloonId = saloonId;
      }
      const count = await prisma.package.count({
        where: packageWhere,
      });
      if (count !== uniquePackageIds.length) {
        res.json(new AppResponse('One or more packages are invalid or do not belong to the selected saloon', {}, 400));
        return;
      }
    }

    // Create the offer in the database
    const offer = await prisma.offer.create({
      data: {
        name,
        description,
        type,
        bannerImage: type === OfferType.BANNER ? bannerImage : '',
        couponCode: type === OfferType.COUPON ? couponCode : '',
        discountType: discountType,
        discountValue: Number(discountValue) || 0,
        isActive,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        saloon: saloonId ? { connect: { id: saloonId } } : undefined,
        services: {
          connect: serviceIds.map((id: string) => ({ id })),
        },
        packages: {
          connect: packageIds.map((id: string) => ({ id })),
        },
      },
      include: {
        saloon: true,
        services: true,
        packages: true,
      },
    });

    res.json(new AppResponse('Offer created successfully', offer, 201));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const getOffers = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const type = req.query.type as OfferType;
    const saloonIdQuery = req.query.saloonId as string;
    const isActive = req.query.isActive as string;

    const andConditions: any[] = [];

    // Saloon scope filter
    // If saloonIdQuery is passed, find offers that belong to saloonIdQuery OR are global (null)
    if (saloonIdQuery) {
      andConditions.push({
        OR: [
          { saloonId: saloonIdQuery },
          { saloonId: null }
        ]
      });
    } else {
      // If no query passed, check if logged in user is a saloon admin
      const user = req.user;
      if (user) {
        const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
        const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);
        if (!isSuperAdmin && isAdmin) {
          andConditions.push({
            OR: [
              { saloonId: (user as any).saloonId },
              { saloonId: null }
            ]
          });
        }
      }
    }

    if (type) {
      andConditions.push({ type });
    }

    if (isActive !== undefined) {
      andConditions.push({ isActive: isActive === 'true' });
    }

    if (search) {
      andConditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { couponCode: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ]
      });
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : {};

    const pagination = getPagination(req);
    const [offers, total] = await Promise.all([
      prisma.offer.findMany({
        where,
        include: {
          saloon: true,
          services: true,
          packages: true,
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.offer.count({ where }),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Offers retrieved successfully', offers, 200, meta));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const getOfferById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid offer ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const offer = await prisma.offer.findUnique({
      where: { id },
      include: {
        saloon: true,
        services: true,
        packages: true,
      },
    });

    if (!offer) {
      res.json(new AppResponse('Offer not found', {}, 404));
      return;
    }

    // Role-based scoping for read access
    const user = req.user;
    if (user && offer.saloonId) {
      const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
      const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);
      if (!isSuperAdmin && isAdmin && (user as any).saloonId !== offer.saloonId) {
        res.json(new AppResponse('Forbidden: Access denied to this offer', {}, 403));
        return;
      }
    }

    res.json(new AppResponse('Offer retrieved successfully', offer, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const updateOffer = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid offer ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('type').optional().isIn(Object.values(OfferType)).withMessage('Invalid offer type').run(req);
    await body('description').optional().trim().run(req);
    await body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').run(req);
    await body('startDate').optional().isISO8601().withMessage('Invalid start date').run(req);
    await body('endDate').optional().isISO8601().withMessage('Invalid end date').run(req);
    await body('serviceIds').optional().isArray().withMessage('serviceIds must be an array of UUIDs').run(req);
    await body('packageIds').optional().isArray().withMessage('packageIds must be an array of UUIDs').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const existingOffer = await prisma.offer.findUnique({
      where: { id },
    });

    if (!existingOffer) {
      res.json(new AppResponse('Offer not found', {}, 404));
      return;
    }

    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        // Saloon admins can only update their own saloon's offers
        if (existingOffer.saloonId !== (user as any).saloonId) {
          res.json(new AppResponse('Forbidden: You can only update offers belonging to your saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    const {
      name,
      description,
      type,
      bannerImage,
      couponCode,
      discountType,
      discountValue,
      isActive,
      startDate,
      endDate,
      serviceIds,
      packageIds,
    } = req.body;

    let saloonId = req.body.saloonId;

    if (!isSuperAdmin && isAdmin) {
      // Saloon admin cannot change saloonId or make it global
      saloonId = existingOffer.saloonId;
    }

    // Determine final properties
    const finalType = type !== undefined ? type : existingOffer.type;
    const targetSaloonId = saloonId !== undefined ? saloonId : existingOffer.saloonId;

    // Verify saloon exists if changing
    if (saloonId && saloonId !== existingOffer.saloonId) {
      const saloonExists = await prisma.saloon.findUnique({
        where: { id: saloonId },
      });
      if (!saloonExists) {
        res.json(new AppResponse('Saloon not found', {}, 404));
        return;
      }
    }

    // Verify type-specific rules
    if (finalType === OfferType.BANNER) {
      const finalBannerImage = bannerImage !== undefined ? bannerImage : existingOffer.bannerImage;
      if (!finalBannerImage) {
        res.json(new AppResponse('Banner image is required for banner offers', {}, 400));
        return;
      }
      const finalDiscountValue = discountValue !== undefined ? Number(discountValue) : existingOffer.discountValue;
      if (finalDiscountValue < 0) {
        res.json(new AppResponse('Discount value must be a positive number', {}, 400));
        return;
      }
    } else if (finalType === OfferType.COUPON) {
      const finalCouponCode = couponCode !== undefined ? couponCode : existingOffer.couponCode;
      const finalDiscountType = discountType !== undefined ? discountType : existingOffer.discountType;
      const finalDiscountValue = discountValue !== undefined ? Number(discountValue) : existingOffer.discountValue;

      if (!finalCouponCode) {
        res.json(new AppResponse('Coupon code is required for coupon offers', {}, 400));
        return;
      }
      if (!Object.values(DiscountType).includes(finalDiscountType)) {
        res.json(new AppResponse('Invalid discount type', {}, 400));
        return;
      }
      if (finalDiscountValue <= 0) {
        res.json(new AppResponse('Discount value must be a positive number', {}, 400));
        return;
      }
    }

    // Verify services if they are being updated
    if (serviceIds !== undefined) {
      const uniqueServiceIds = [...new Set(serviceIds as string[])];
      const serviceWhere: any = { id: { in: uniqueServiceIds } };
      if (targetSaloonId) {
        serviceWhere.saloonId = targetSaloonId;
      }
      const count = await prisma.service.count({
        where: serviceWhere,
      });
      if (count !== uniqueServiceIds.length) {
        res.json(new AppResponse('One or more services are invalid or do not belong to the target saloon', {}, 400));
        return;
      }
    }

    // Verify packages if they are being updated
    if (packageIds !== undefined) {
      const uniquePackageIds = [...new Set(packageIds as string[])];
      const packageWhere: any = { id: { in: uniquePackageIds } };
      if (targetSaloonId) {
        packageWhere.saloonId = targetSaloonId;
      }
      const count = await prisma.package.count({
        where: packageWhere,
      });
      if (count !== uniquePackageIds.length) {
        res.json(new AppResponse('One or more packages are invalid or do not belong to the target saloon', {}, 400));
        return;
      }
    }

    // Update fields
    const updatedOffer = await prisma.offer.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingOffer.name,
        description: description !== undefined ? description : existingOffer.description,
        type: finalType,
        bannerImage: finalType === OfferType.BANNER ? (bannerImage !== undefined ? bannerImage : existingOffer.bannerImage) : '',
        couponCode: finalType === OfferType.COUPON ? (couponCode !== undefined ? couponCode : existingOffer.couponCode) : '',
        discountType: discountType !== undefined ? discountType : existingOffer.discountType,
        discountValue: discountValue !== undefined ? (Number(discountValue) || 0) : existingOffer.discountValue,
        isActive: isActive !== undefined ? isActive : existingOffer.isActive,
        startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : existingOffer.startDate,
        endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : existingOffer.endDate,
        saloonId: saloonId === null ? null : (saloonId !== undefined ? saloonId : existingOffer.saloonId),
        services: serviceIds !== undefined ? {
          set: serviceIds.map((sid: string) => ({ id: sid })),
        } : undefined,
        packages: packageIds !== undefined ? {
          set: packageIds.map((pid: string) => ({ id: pid })),
        } : undefined,
      },
      include: {
        saloon: true,
        services: true,
        packages: true,
      },
    });

    res.json(new AppResponse('Offer updated successfully', updatedOffer, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const deleteOffer = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid offer ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const existingOffer = await prisma.offer.findUnique({
      where: { id },
    });

    if (!existingOffer) {
      res.json(new AppResponse('Offer not found', {}, 404));
      return;
    }

    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingOffer.saloonId !== (user as any).saloonId) {
          res.json(new AppResponse('Forbidden: You can only delete offers from your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    await prisma.offer.delete({
      where: { id },
    });

    res.json(new AppResponse('Offer deleted successfully', {}, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

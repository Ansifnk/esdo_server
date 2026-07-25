import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role, ServiceGender } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createService = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('shortDescription').optional().isString().withMessage('Short description must be a string').run(req);
    await body('nickName').optional().isString().withMessage('Nickname must be a string').run(req);
    await body('description').trim().notEmpty().withMessage('Description is required').run(req);
    await body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number').run(req);
    await body('discountPrice').isFloat({ min: 0 }).withMessage('Discount price must be a positive number').run(req);
    await body('saloonId').isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('primaryImage').optional().isString().withMessage('Primary image must be a string').run(req);
    await body('images').optional().isArray().withMessage('Images must be an array of strings').run(req);
    await body('serviceGender').optional().isIn(Object.values(ServiceGender)).withMessage('Invalid serviceGender').run(req);
    await body('categoryIds').optional().isArray().withMessage('categoryIds must be an array').run(req);
    await body('subCategoryIds').optional().isArray().withMessage('subCategoryIds must be an array').run(req);
    await body('stylistIds').optional().isArray().withMessage('stylistIds must be an array').run(req);
    await body('afterCareMessage').optional().isString().withMessage('AfterCare message must be a string').run(req);
    await body('duration').optional().isInt({ min: 0 }).withMessage('Duration must be a positive integer').run(req);
    await body('relatedServiceIds').optional().isArray().withMessage('relatedServiceIds must be an array').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const {
      name,
      shortDescription = '',
      nickName = '',
      description,
      price,
      discountPrice,
      saloonId,
      primaryImage = '',
      images = [],
      serviceGender = ServiceGender.UNI,
      categoryIds = [],
      subCategoryIds = [],
      stylistIds = [],
      afterCareMessage = '',
      duration = 0,
      relatedServiceIds = [],
    } = req.body;

    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if ((user as any).saloonId !== saloonId) {
          res.json(new AppResponse('Forbidden: You can only add services to your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    // Verify Saloon exists
    const saloonExists = await prisma.saloon.findUnique({
      where: { id: saloonId },
    });
    if (!saloonExists) {
      res.json(new AppResponse('Saloon not found', {}, 404));
      return;
    }

    // Verify related services belong to the selected saloon
    if (relatedServiceIds && relatedServiceIds.length > 0) {
      const uniqueRelatedServiceIds = [...new Set(relatedServiceIds as string[])];
      const count = await prisma.service.count({
        where: {
          id: { in: uniqueRelatedServiceIds },
          saloonId: saloonId,
        },
      });
      if (count !== uniqueRelatedServiceIds.length) {
        throw new AppError('One or more related services do not belong to the selected saloon', 400);
      }
    }

    // Create service in database
    const service = await prisma.service.create({
      data: {
        name,
        shortDescription,
        nickName,
        description,
        price,
        discountPrice,
        serviceGender,
        primaryImage,
        images,
        afterCareMessage,
        duration,
        saloon: { connect: { id: saloonId } },
        categories: {
          connect: categoryIds.map((id: string) => ({ id })),
        },
        subCategories: {
          connect: subCategoryIds.map((id: string) => ({ id })),
        },
        stylists: {
          connect: stylistIds.map((id: string) => ({ id })),
        },
        relatedServices: {
          connect: relatedServiceIds.map((id: string) => ({ id })),
        },
      },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        stylists: true,
        relatedServices: true,
      },
    });

    res.json(new AppResponse('Service created successfully', service, 201));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const getServices = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const saloonIdQuery = req.query.saloonId as string;
    const categoryIdQuery = req.query.categoryId as string;
    const subCategoryIdQuery = req.query.subCategoryId as string;
    const staffIdQuery = req.query.staffId as string;
    const genderQuery = req.query.serviceGender as ServiceGender;

    const where: any = {};

    if (saloonIdQuery) {
      where.saloonId = saloonIdQuery;
    }

    if (categoryIdQuery) {
      where.categories = {
        some: { id: categoryIdQuery },
      };
    }

    if (subCategoryIdQuery) {
      where.subCategories = {
        some: { id: subCategoryIdQuery },
      };
    }

    if (staffIdQuery) {
      where.stylists = {
        some: { id: staffIdQuery },
      };
    }

    if (genderQuery && Object.values(ServiceGender).includes(genderQuery)) {
      where.serviceGender = genderQuery;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nickName: { contains: search, mode: 'insensitive' } },
        { shortDescription: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pagination = getPagination(req);
    const [services, total] = await Promise.all([
      prisma.service.findMany({
        where,
        include: {
          saloon: true,
          categories: true,
          subCategories: true,
          stylists: true,
          relatedServices: true,
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.service.count({ where }),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Services retrieved successfully', services, 200, meta));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const getServiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid service ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        stylists: true,
        relatedServices: true,
      },
    });

    if (!service) {
      res.json(new AppResponse('Service not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Service retrieved successfully', service, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const updateService = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid service ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('shortDescription').optional().isString().withMessage('Short description must be a string').run(req);
    await body('nickName').optional().isString().withMessage('Nickname must be a string').run(req);
    await body('description').optional().trim().notEmpty().withMessage('Description cannot be empty').run(req);
    await body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number').run(req);
    await body('discountPrice').optional().isFloat({ min: 0 }).withMessage('Discount price must be a positive number').run(req);
    await body('saloonId').optional().isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('primaryImage').optional().isString().withMessage('Primary image must be a string').run(req);
    await body('images').optional().isArray().withMessage('Images must be an array of strings').run(req);
    await body('serviceGender').optional().isIn(Object.values(ServiceGender)).withMessage('Invalid serviceGender').run(req);
    await body('categoryIds').optional().isArray().withMessage('categoryIds must be an array').run(req);
    await body('subCategoryIds').optional().isArray().withMessage('subCategoryIds must be an array').run(req);
    await body('stylistIds').optional().isArray().withMessage('stylistIds must be an array').run(req);
    await body('afterCareMessage').optional().isString().withMessage('AfterCare message must be a string').run(req);
    await body('duration').optional().isInt({ min: 0 }).withMessage('Duration must be a positive integer').run(req);
    await body('relatedServiceIds').optional().isArray().withMessage('relatedServiceIds must be an array').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const {
      name,
      shortDescription,
      nickName,
      description,
      price,
      discountPrice,
      saloonId,
      primaryImage,
      images,
      serviceGender,
      categoryIds,
      subCategoryIds,
      stylistIds,
      afterCareMessage,
      duration,
      relatedServiceIds,
    } = req.body;

    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingService = await prisma.service.findUnique({
      where: { id },
    });
    if (!existingService) {
      res.json(new AppResponse('Service not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingService.saloonId !== (user as any).saloonId || (saloonId && saloonId !== (user as any).saloonId)) {
          res.json(new AppResponse('Forbidden: You can only update services belonging to your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    if (saloonId) {
      const saloonExists = await prisma.saloon.findUnique({
        where: { id: saloonId },
      });
      if (!saloonExists) {
        res.json(new AppResponse('Saloon not found', {}, 404));
        return;
      }
    }

    // Verify related services belong to the target saloon
    const targetSaloonId = saloonId !== undefined ? saloonId : existingService.saloonId;
    const servicesToCheck = relatedServiceIds !== undefined 
      ? relatedServiceIds 
      : (saloonId !== undefined && saloonId !== existingService.saloonId 
          ? (await prisma.service.findUnique({
              where: { id },
              select: { relatedServices: { select: { id: true } } }
            }))?.relatedServices.map(s => s.id) || []
          : []);

    if (servicesToCheck.length > 0) {
      const uniqueServicesToCheck = [...new Set(servicesToCheck as string[])];
      const count = await prisma.service.count({
        where: {
          id: { in: uniqueServicesToCheck },
          saloonId: targetSaloonId,
        },
      });
      if (count !== uniqueServicesToCheck.length) {
        throw new AppError('One or more related services do not belong to the selected saloon', 400);
      }
    }

    const updatedService = await prisma.service.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingService.name,
        shortDescription: shortDescription !== undefined ? shortDescription : existingService.shortDescription,
        nickName: nickName !== undefined ? nickName : existingService.nickName,
        description: description !== undefined ? description : existingService.description,
        price: price !== undefined ? price : existingService.price,
        discountPrice: discountPrice !== undefined ? discountPrice : existingService.discountPrice,
        saloonId: saloonId !== undefined ? saloonId : existingService.saloonId,
        primaryImage: primaryImage !== undefined ? primaryImage : existingService.primaryImage,
        images: images !== undefined ? images : existingService.images,
        serviceGender: serviceGender !== undefined ? serviceGender : existingService.serviceGender,
        afterCareMessage: afterCareMessage !== undefined ? afterCareMessage : existingService.afterCareMessage,
        duration: duration !== undefined ? duration : existingService.duration,
        categories: categoryIds !== undefined ? {
          set: categoryIds.map((cid: string) => ({ id: cid })),
        } : undefined,
        subCategories: subCategoryIds !== undefined ? {
          set: subCategoryIds.map((scid: string) => ({ id: scid })),
        } : undefined,
        stylists: stylistIds !== undefined ? {
          set: stylistIds.map((sid: string) => ({ id: sid })),
        } : undefined,
        relatedServices: relatedServiceIds !== undefined ? {
          set: relatedServiceIds.map((rsid: string) => ({ id: rsid })),
        } : undefined,
      },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        stylists: true,
        relatedServices: true,
      },
    });

    res.json(new AppResponse('Service updated successfully', updatedService, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const deleteService = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid service ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingService = await prisma.service.findUnique({
      where: { id },
    });
    if (!existingService) {
      res.json(new AppResponse('Service not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingService.saloonId !== (user as any).saloonId) {
          res.json(new AppResponse('Forbidden: You can only delete services from your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    await prisma.service.delete({
      where: { id },
    });

    res.json(new AppResponse('Service deleted successfully', {}, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

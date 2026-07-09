import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createPackage = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('description').trim().notEmpty().withMessage('Description is required').run(req);
    await body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number').run(req);
    await body('discountPrice').isFloat({ min: 0 }).withMessage('Discount price must be a positive number').run(req);
    await body('saloonId').isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('primaryImage').optional().isString().withMessage('Primary image must be a string').run(req);
    await body('images').optional().isArray().withMessage('Images must be an array of strings').run(req);
    await body('serviceIds').optional().isArray().withMessage('serviceIds must be an array').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const {
      name,
      description,
      price,
      discountPrice,
      saloonId,
      primaryImage = '',
      images = [],
      serviceIds = [],
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
          res.json(new AppResponse('Forbidden: You can only add packages to your own saloon', {}, 403));
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

    // Verify services belong to the selected saloon
    if (serviceIds && serviceIds.length > 0) {
      const uniqueServiceIds = [...new Set(serviceIds as string[])];
      const count = await prisma.service.count({
        where: {
          id: { in: uniqueServiceIds },
          saloonId: saloonId,
        },
      });
      if (count !== uniqueServiceIds.length) {
        throw new AppError('One or more services do not belong to the selected saloon', 400);
      }
    }

    // Create package in database
    const pkg = await prisma.package.create({
      data: {
        name,
        description,
        price,
        discountPrice,
        primaryImage,
        images,
        saloon: { connect: { id: saloonId } },
        services: {
          connect: serviceIds.map((id: string) => ({ id })),
        },
      },
      include: {
        saloon: true,
        services: true,
      },
    });

    res.json(new AppResponse('Package created successfully', pkg, 201));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const getPackages = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const saloonIdQuery = req.query.saloonId as string;

    const where: any = {};

    if (saloonIdQuery) {
      where.saloonId = saloonIdQuery;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pagination = getPagination(req);
    const [packages, total] = await Promise.all([
      prisma.package.findMany({
        where,
        include: {
          saloon: true,
          services: true,
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.package.count({ where }),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Packages retrieved successfully', packages, 200, meta));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const getPackageById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid package ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const pkg = await prisma.package.findUnique({
      where: { id },
      include: {
        saloon: true,
        services: true,
      },
    });

    if (!pkg) {
      res.json(new AppResponse('Package not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Package retrieved successfully', pkg, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const updatePackage = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid package ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('description').optional().trim().notEmpty().withMessage('Description cannot be empty').run(req);
    await body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number').run(req);
    await body('discountPrice').optional().isFloat({ min: 0 }).withMessage('Discount price must be a positive number').run(req);
    await body('saloonId').optional().isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('primaryImage').optional().isString().withMessage('Primary image must be a string').run(req);
    await body('images').optional().isArray().withMessage('Images must be an array of strings').run(req);
    await body('serviceIds').optional().isArray().withMessage('serviceIds must be an array').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const {
      name,
      description,
      price,
      discountPrice,
      saloonId,
      primaryImage,
      images,
      serviceIds,
    } = req.body;

    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingPackage = await prisma.package.findUnique({
      where: { id },
    });
    if (!existingPackage) {
      res.json(new AppResponse('Package not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingPackage.saloonId !== (user as any).saloonId || (saloonId && saloonId !== (user as any).saloonId)) {
          res.json(new AppResponse('Forbidden: You can only update packages belonging to your own saloon', {}, 403));
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

    // Verify services belong to the target saloon
    const targetSaloonId = saloonId !== undefined ? saloonId : existingPackage.saloonId;
    const servicesToCheck = serviceIds !== undefined 
      ? serviceIds 
      : (saloonId !== undefined && saloonId !== existingPackage.saloonId 
          ? (await prisma.package.findUnique({
              where: { id },
              select: { services: { select: { id: true } } }
            }))?.services.map(s => s.id) || []
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
        throw new AppError('One or more services do not belong to the selected saloon', 400);
      }
    }

    const updatedPackage = await prisma.package.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingPackage.name,
        description: description !== undefined ? description : existingPackage.description,
        price: price !== undefined ? price : existingPackage.price,
        discountPrice: discountPrice !== undefined ? discountPrice : existingPackage.discountPrice,
        saloonId: saloonId !== undefined ? saloonId : existingPackage.saloonId,
        primaryImage: primaryImage !== undefined ? primaryImage : existingPackage.primaryImage,
        images: images !== undefined ? images : existingPackage.images,
        services: serviceIds !== undefined ? {
          set: serviceIds.map((sid: string) => ({ id: sid })),
        } : undefined,
      },
      include: {
        saloon: true,
        services: true,
      },
    });

    res.json(new AppResponse('Package updated successfully', updatedPackage, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

export const deletePackage = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid package ID format').run(req);

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

    const existingPackage = await prisma.package.findUnique({
      where: { id },
    });
    if (!existingPackage) {
      res.json(new AppResponse('Package not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingPackage.saloonId !== (user as any).saloonId) {
          res.json(new AppResponse('Forbidden: You can only delete packages from your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    await prisma.package.delete({
      where: { id },
    });

    res.json(new AppResponse('Package deleted successfully', {}, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const getPackageSettings = async (_req: Request, res: Response): Promise<void> => {
  try {
    let setting = await prisma.packageSetting.findFirst();
    if (!setting) {
      setting = await prisma.packageSetting.create({
        data: {
          discountPercentage: 15.0,
        },
      });
    }
    res.json(new AppResponse('Package settings retrieved', setting, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Failed to get package settings', {}, status));
  }
};

export const updatePackageSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { discountPercentage } = req.body;
    const numDiscount = Number(discountPercentage);
    if (isNaN(numDiscount) || numDiscount < 0 || numDiscount > 100) {
      res.json(new AppResponse('Valid discount percentage between 0 and 100 is required', {}, 400));
      return;
    }

    let setting = await prisma.packageSetting.findFirst();
    if (!setting) {
      setting = await prisma.packageSetting.create({
        data: { discountPercentage: numDiscount },
      });
    } else {
      setting = await prisma.packageSetting.update({
        where: { id: setting.id },
        data: { discountPercentage: numDiscount },
      });
    }

    // Recalculate discountPrice for all packages in the database:
    // "also this percentage discount will be same for all packages. including the package created from the admin."
    const allPackages = await prisma.package.findMany();
    for (const pkg of allPackages) {
      const basePrice = pkg.price;
      const newDiscountPrice = Math.max(0, Math.round(basePrice * (1 - numDiscount / 100)));
      await prisma.package.update({
        where: { id: pkg.id },
        data: { discountPrice: newDiscountPrice },
      });
    }

    res.json(new AppResponse('Package settings updated and applied to all packages', setting, 200));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Failed to update package settings', {}, status));
  }
};

export const createCustomPackage = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.json(new AppResponse('Authentication required to create a custom package', {}, 401));
      return;
    }

    const { name, serviceIds, saloonId } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.json(new AppResponse('Package name is required', {}, 400));
      return;
    }

    if (!saloonId || typeof saloonId !== 'string') {
      res.json(new AppResponse('Saloon ID is required', {}, 400));
      return;
    }

    const uniqueServiceIds = Array.isArray(serviceIds) ? [...new Set(serviceIds as string[])] : [];
    if (uniqueServiceIds.length < 2) {
      res.json(new AppResponse('At least 2 services must be selected to create a package bundle', {}, 400));
      return;
    }
    const services = await prisma.service.findMany({
      where: {
        id: { in: uniqueServiceIds },
        saloonId: saloonId,
      },
    });

    if (services.length !== uniqueServiceIds.length) {
      res.json(new AppResponse('One or more selected services do not belong to the selected saloon', {}, 400));
      return;
    }

    // Calculate total price based on service prices
    const totalPrice = services.reduce((sum, s) => {
      const servicePrice = s.discountPrice > 0 ? s.discountPrice : s.price;
      return sum + servicePrice;
    }, 0);

    // Retrieve active discount percentage
    let setting = await prisma.packageSetting.findFirst();
    const discountPercentage = setting ? setting.discountPercentage : 15.0;
    const discountPrice = Math.max(0, Math.round(totalPrice * (1 - discountPercentage / 100)));

    const serviceNames = services.map((s) => s.name).join(', ');
    const description = `Custom package created by you with ${services.length} services: ${serviceNames}`;
    const primaryImage = services.find((s) => s.primaryImage)?.primaryImage || '';

    const customPkg = await prisma.package.create({
      data: {
        name: name.trim(),
        nickName: 'Custom Package',
        description,
        price: totalPrice,
        discountPrice,
        primaryImage,
        images: services.map((s) => s.primaryImage).filter(Boolean),
        saloonId,
        customerId: user.id,
        isCustom: true,
        services: {
          connect: uniqueServiceIds.map((id) => ({ id })),
        },
      },
      include: {
        saloon: true,
        services: true,
      },
    });

    res.json(new AppResponse('Custom package created successfully', customPkg, 201));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Failed to create custom package', {}, status));
  }
};

export const createPackage = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('nickName').optional().isString().withMessage('nickName must be a string').run(req);
    await body('description').trim().notEmpty().withMessage('Description is required').run(req);
    await body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number').run(req);
    await body('discountPrice').optional().isFloat({ min: 0 }).withMessage('Discount price must be a positive number').run(req);
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
      nickName = '',
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

    // Verify services belong to the selected saloon and at least 2 are selected
    const uniqueServiceIds = Array.isArray(serviceIds) ? [...new Set(serviceIds as string[])] : [];
    if (uniqueServiceIds.length < 2) {
      res.json(new AppResponse('At least 2 services must be selected for a package', {}, 400));
      return;
    }

    const count = await prisma.service.count({
      where: {
        id: { in: uniqueServiceIds },
        saloonId: saloonId,
      },
    });
    if (count !== uniqueServiceIds.length) {
      throw new AppError('One or more services do not belong to the selected saloon', 400);
    }

    // Auto-calculate discountPrice using global percentage if not specified or zero
    let finalDiscountPrice = discountPrice !== undefined ? Number(discountPrice) : 0;
    if (!finalDiscountPrice || finalDiscountPrice <= 0) {
      const setting = await prisma.packageSetting.findFirst();
      const pct = setting ? setting.discountPercentage : 15.0;
      finalDiscountPrice = Math.max(0, Math.round(Number(price) * (1 - pct / 100)));
    }

    // Create package in database
    const pkg = await prisma.package.create({
      data: {
        name,
        nickName,
        description,
        price,
        discountPrice: finalDiscountPrice,
        primaryImage,
        images,
        isCustom: false,
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
    const customerIdQuery = (req.query.customerId as string) || (req.user?.roles.some((r: any) => r.role === Role.CUSTOMER) ? req.user.id : undefined);

    const where: any = {};

    if (saloonIdQuery) {
      where.saloonId = saloonIdQuery;
    }

    // Check if caller is Admin / Super Admin
    const isSuperAdmin = req.user?.roles?.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = req.user?.roles?.some((r: any) => r.role === Role.ADMIN);

    if (isSuperAdmin || isAdmin) {
      // In admin view, by default show standard packages (isCustom: false)
      if (req.query.includeCustom !== 'true') {
        where.isCustom = false;
      }
    } else {
      // In customer/visitor view:
      // Show public packages PLUS custom packages for that specific user
      if (customerIdQuery) {
        where.OR = [
          { isCustom: false },
          { customerId: customerIdQuery, isCustom: true },
        ];
      } else {
        where.isCustom = false;
      }
    }

    if (search) {
      const searchCondition = [
        { name: { contains: search, mode: 'insensitive' } },
        { nickName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchCondition },
        ];
        delete where.OR;
      } else {
        where.OR = searchCondition;
      }
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
        // Custom packages for the specific user are ordered FIRST!
        orderBy: [
          { isCustom: 'desc' },
          { createdAt: 'desc' },
        ],
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
    await body('nickName').optional().isString().withMessage('nickName must be a string').run(req);
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
      nickName,
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
        nickName: nickName !== undefined ? nickName : existingPackage.nickName,
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

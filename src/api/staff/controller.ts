import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { Role, ServiceGender, StaffType } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('phone').optional().isString().withMessage('Phone must be a string').run(req);
    await body('languages').optional().isArray().withMessage('languages must be an array').run(req);
    await body('saloonId').isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('categoryIds').optional().isArray().withMessage('categoryIds must be an array').run(req);
    await body('subCategoryIds').optional().isArray().withMessage('subCategoryIds must be an array').run(req);
    await body('availabilities').optional().isArray().withMessage('availabilities must be an array').run(req);
    await body('overrides').optional().isArray().withMessage('overrides must be an array').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);
    await body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').run(req);
    await body('serviceGender').optional().isIn(Object.values(ServiceGender)).withMessage('Invalid serviceGender').run(req);
    await body('type').optional().isIn(Object.values(StaffType)).withMessage('Invalid staff type').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const {
      name,
      phone = '',
      languages = [],
      saloonId,
      categoryIds = [],
      subCategoryIds = [],
      availabilities = [],
      overrides = [],
      image = '',
      isActive = true,
      serviceGender = ServiceGender.UNI,
      type = StaffType.STYLIST,
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
          res.json(new AppResponse('Forbidden: You can only add staff to your own saloon', {}, 403));
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

    // Create staff in database
    const staff = await prisma.staff.create({
      data: {
        name,
        phone,
        languages,
        image,
        isActive,
        serviceGender,
        type,
        saloon: { connect: { id: saloonId } },
        categories: {
          connect: categoryIds.map((id: string) => ({ id })),
        },
        subCategories: {
          connect: subCategoryIds.map((id: string) => ({ id })),
        },
        availabilities: {
          create: availabilities.map((av: any) => ({
            startDate: av.startDate || '',
            endDate: av.endDate || '',
            startTime: av.startTime,
            endTime: av.endTime,
          })),
        },
        overrides: {
          create: overrides.map((o: any) => ({
            date: o.date,
            type: o.type || 'LEAVE',
            startTime: o.startTime || null,
            endTime: o.endTime || null,
            reason: o.reason || null,
          })),
        },
      },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        availabilities: true,
        overrides: true,
      },
    });

    res.json(new AppResponse('Staff member created successfully', staff, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getStaffs = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const saloonIdQuery = req.query.saloonId as string;
    const saloonIdsRaw = req.query.saloonIds || req.query['saloonIds[]'];
    let saloonIds: string[] = [];

    if (saloonIdsRaw) {
      if (Array.isArray(saloonIdsRaw)) {
        saloonIds = saloonIdsRaw.map((id) => String(id).trim()).filter((id) => id.length > 0);
      } else if (typeof saloonIdsRaw === 'string') {
        saloonIds = saloonIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
      }
    }

    const where: any = {};

    const user = req.user;
    if (user) {
      const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
      const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

      if (!isSuperAdmin && isAdmin) {
        where.saloonId = (user as any).saloonId;
      } else if (saloonIds.length > 0) {
        where.saloonId = { in: saloonIds };
      } else if (saloonIdQuery) {
        where.saloonId = saloonIdQuery;
      }
    } else if (saloonIds.length > 0) {
      where.saloonId = { in: saloonIds };
    } else if (saloonIdQuery) {
      where.saloonId = saloonIdQuery;
    }

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const pagination = getPagination(req);
    const [staffs, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        include: {
          saloon: true,
          categories: true,
          subCategories: true,
          availabilities: true,
          overrides: true,
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.staff.count({ where }),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Staff members retrieved successfully', staffs, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getStaffById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid staff ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const user = req.user;

    const staff = await prisma.staff.findUnique({
      where: { id },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        availabilities: true,
        overrides: true,
      },
    });

    if (!staff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    if (user) {
      const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
      const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

      if (!isSuperAdmin && isAdmin && staff.saloonId !== (user as any).saloonId) {
        res.json(new AppResponse('Forbidden: Access denied to this staff member', {}, 403));
        return;
      }
    }

    res.json(new AppResponse('Staff member retrieved successfully', staff, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid staff ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('phone').optional().isString().withMessage('Phone must be a string').run(req);
    await body('languages').optional().isArray().withMessage('languages must be an array').run(req);
    await body('saloonId').optional().isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('categoryIds').optional().isArray().withMessage('categoryIds must be an array').run(req);
    await body('subCategoryIds').optional().isArray().withMessage('subCategoryIds must be an array').run(req);
    await body('availabilities').optional().isArray().withMessage('availabilities must be an array').run(req);
    await body('overrides').optional().isArray().withMessage('overrides must be an array').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);
    await body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').run(req);
    await body('serviceGender').optional().isIn(Object.values(ServiceGender)).withMessage('Invalid serviceGender').run(req);
    await body('type').optional().isIn(Object.values(StaffType)).withMessage('Invalid staff type').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const { name, phone, languages, saloonId, categoryIds, subCategoryIds, availabilities, overrides, image, isActive, serviceGender, type } = req.body;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingStaff = await prisma.staff.findUnique({
      where: { id },
    });
    if (!existingStaff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingStaff.saloonId !== (user as any).saloonId || (saloonId && saloonId !== (user as any).saloonId)) {
          res.json(new AppResponse('Forbidden: You can only update staff belonging to your own saloon', {}, 403));
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

    // Execute update in transaction
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id },
        data: {
          name: name ?? existingStaff.name,
          phone: phone ?? existingStaff.phone,
          languages: languages ?? existingStaff.languages,
          saloonId: saloonId ?? existingStaff.saloonId,
          image: image ?? existingStaff.image,
          isActive: isActive ?? existingStaff.isActive,
          serviceGender: serviceGender ?? existingStaff.serviceGender,
          type: type ?? existingStaff.type,
          categories: categoryIds !== undefined ? {
            set: categoryIds.map((cid: string) => ({ id: cid })),
          } : undefined,
          subCategories: subCategoryIds !== undefined ? {
            set: subCategoryIds.map((scid: string) => ({ id: scid })),
          } : undefined,
        },
      });

      if (availabilities !== undefined) {
        await tx.staffAvailability.deleteMany({
          where: { staffId: id },
        });

        if (availabilities.length > 0) {
          await tx.staffAvailability.createMany({
            data: availabilities.map((av: any) => ({
              staffId: id,
              startDate: av.startDate || '',
              endDate: av.endDate || '',
              startTime: av.startTime,
              endTime: av.endTime,
            })),
          });
        }
      }

      if (overrides !== undefined) {
        await tx.staffScheduleOverride.deleteMany({
          where: { staffId: id },
        });

        if (overrides.length > 0) {
          await tx.staffScheduleOverride.createMany({
            data: overrides.map((o: any) => ({
              staffId: id,
              date: o.date,
              type: o.type || 'LEAVE',
              startTime: o.startTime || null,
              endTime: o.endTime || null,
              reason: o.reason || null,
            })),
          });
        }
      }
    });

    const updatedStaff = await prisma.staff.findUnique({
      where: { id },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        availabilities: true,
        overrides: true,
      },
    });

    if (!updatedStaff) {
      res.json(new AppResponse('Staff member not found after update', {}, 404));
      return;
    }

    res.json(new AppResponse('Staff member updated successfully', updatedStaff, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid staff ID format').run(req);

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

    const existingStaff = await prisma.staff.findUnique({
      where: { id },
    });
    if (!existingStaff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingStaff.saloonId !== (user as any).saloonId) {
          res.json(new AppResponse('Forbidden: You can only delete staff from your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    await prisma.staff.delete({
      where: { id },
    });

    res.json(new AppResponse('Staff member deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

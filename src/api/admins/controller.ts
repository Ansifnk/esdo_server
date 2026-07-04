import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { Role } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('email').isEmail().withMessage('Valid email is required').run(req);
    await body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters').run(req);
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('saloonId').isUUID().withMessage('Valid saloon ID is required').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { email, password, name, saloonId } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.json(new AppResponse('User with this email already exists', {}, 400));
      return;
    }

    // Verify Saloon exists
    const saloonExists = await prisma.saloon.findUnique({
      where: { id: saloonId },
    });
    if (!saloonExists) {
      res.json(new AppResponse('Saloon not found', {}, 404));
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user in database with role ADMIN
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        saloonId,
        roles: {
          create: {
            role: Role.ADMIN,
          },
        },
      },
      include: {
        roles: true,
        saloon: true,
      },
    });

    const { password: _, ...userWithoutPassword } = user;
    res.json(new AppResponse('Admin created successfully', userWithoutPassword, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getAdmins = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const saloonIdQuery = req.query.saloonId as string;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    const where: any = {
      roles: {
        some: {
          role: Role.ADMIN,
        },
      },
    };

    if (!isSuperAdmin && isAdmin) {
      // Force filter by current user's saloon
      where.saloonId = (user as any).saloonId;
    } else if (saloonIdQuery) {
      where.saloonId = saloonIdQuery;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pagination = getPagination(req);
    const [admins, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          roles: true,
          saloon: true,
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    // Strip passwords
    const adminsWithoutPasswords = admins.map(({ password, ...admin }) => admin);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Admins retrieved successfully', adminsWithoutPasswords, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getAdminById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid admin ID format').run(req);

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

    // Allow all if super admin, otherwise allow only logged-in user's own profile
    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    if (!isSuperAdmin && user.id !== id) {
      res.json(new AppResponse('Forbidden: Access denied', {}, 403));
      return;
    }

    const admin = await prisma.user.findFirst({
      where: {
        id,
        roles: {
          some: {
            role: Role.ADMIN,
          },
        },
      },
      include: {
        roles: true,
        saloon: true,
      },
    });

    if (!admin) {
      res.json(new AppResponse('Admin not found', {}, 404));
      return;
    }

    const { password: _, ...adminWithoutPassword } = admin;
    res.json(new AppResponse('Admin retrieved successfully', adminWithoutPassword, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid admin ID format').run(req);
    await body('email').optional().isEmail().withMessage('Valid email is required').run(req);
    await body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('saloonId').optional().isUUID().withMessage('Invalid saloon ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const { email, password, name, saloonId } = req.body;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingAdmin = await prisma.user.findFirst({
      where: {
        id,
        roles: {
          some: {
            role: Role.ADMIN,
          },
        },
      },
    });

    if (!existingAdmin) {
      res.json(new AppResponse('Admin not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        // Admins can only update their own profile
        if (existingAdmin.id !== user.id) {
          res.json(new AppResponse('Forbidden: You can only update your own profile', {}, 403));
          return;
        }
        // Admins cannot change their saloonId
        if (saloonId && saloonId !== existingAdmin.saloonId) {
          res.json(new AppResponse('Forbidden: You cannot change your saloon assignment', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    // Check email uniqueness if email is changed
    if (email && email !== existingAdmin.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
      });
      if (emailExists) {
        res.json(new AppResponse('Email is already in use', {}, 400));
        return;
      }
    }

    // Verify Saloon exists if saloonId is changed
    if (saloonId && saloonId !== existingAdmin.saloonId) {
      const saloonExists = await prisma.saloon.findUnique({
        where: { id: saloonId },
      });
      if (!saloonExists) {
        res.json(new AppResponse('Saloon not found', {}, 404));
        return;
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (saloonId) updateData.saloonId = saloonId;
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        roles: true,
        saloon: true,
      },
    });

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json(new AppResponse('Admin updated successfully', userWithoutPassword, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid admin ID format').run(req);

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


    // Only SUPER_ADMIN can delete admins
    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    if (!isSuperAdmin) {
      res.json(new AppResponse('Forbidden: Only super admin can delete admins', {}, 403));
      return;
    }

    const existingAdmin = await prisma.user.findFirst({
      where: {
        id,
        roles: {
          some: {
            role: Role.ADMIN,
          },
        },
      },
    });

    if (!existingAdmin) {
      res.json(new AppResponse('Admin not found', {}, 404));
      return;
    }

    await prisma.user.delete({
      where: { id },
    });

    res.json(new AppResponse('Admin deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

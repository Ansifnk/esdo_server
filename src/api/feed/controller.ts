import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { Role } from '../../generated/prisma/enums';

export const feedSuperAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.json(new AppResponse('Email, password, and name are required', {}, 400));
      return;
    }

    // Check if any super admin already exists in the database
    const superAdminExists = await prisma.user.findFirst({
      where: {
        roles: {
          some: {
            role: Role.SUPER_ADMIN,
          },
        },
      },
    });

    if (superAdminExists) {
      res.json(new AppResponse('Forbidden: A super admin already exists in the system', {}, 403));
      return;
    }

    // Check if a user with this email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.json(new AppResponse('User with this email already exists', {}, 400));
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create super admin
    const superAdmin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        roles: {
          create: {
            role: Role.SUPER_ADMIN,
          },
        },
      },
      include: {
        roles: true,
      },
    });

    const { password: _, ...superAdminWithoutPassword } = superAdmin;
    res.json(new AppResponse('Super admin created successfully', superAdminWithoutPassword, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

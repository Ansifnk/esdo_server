import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { Role } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createSaloon = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('location').trim().notEmpty().withMessage('Location is required').run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { name, location } = req.body;

    const saloon = await prisma.saloon.create({
      data: {
        name,
        location,
      },
    });

    res.json(new AppResponse('Saloon created successfully', saloon, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getSaloons = async (req: Request, res: Response): Promise<void> => {
  try {
    const pagination = getPagination(req);
    const [saloons, total] = await Promise.all([
      prisma.saloon.findMany({
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.saloon.count(),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Saloons retrieved successfully', saloons, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getSaloonById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid saloon ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const saloon = await prisma.saloon.findUnique({
      where: { id },
    });

    if (!saloon) {
      res.json(new AppResponse('Saloon not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Saloon retrieved successfully', saloon, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateSaloon = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('location').optional().trim().notEmpty().withMessage('Location cannot be empty').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const { name, location } = req.body;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if ((user as any).saloonId !== id) {
          res.json(new AppResponse('Forbidden: You can only update your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    const existingSaloon = await prisma.saloon.findUnique({
      where: { id },
    });
    if (!existingSaloon) {
      res.json(new AppResponse('Saloon not found', {}, 404));
      return;
    }

    const updatedSaloon = await prisma.saloon.update({
      where: { id },
      data: {
        name: name ?? existingSaloon.name,
        location: location ?? existingSaloon.location,
      },
    });

    res.json(new AppResponse('Saloon updated successfully', updatedSaloon, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteSaloon = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid saloon ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;

    const existingSaloon = await prisma.saloon.findUnique({
      where: { id },
    });
    if (!existingSaloon) {
      res.json(new AppResponse('Saloon not found', {}, 404));
      return;
    }

    await prisma.saloon.delete({
      where: { id },
    });

    res.json(new AppResponse('Saloon deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

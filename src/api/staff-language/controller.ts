import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createStaffLanguage = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Language name is required').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { name }: { name: string } = req.body;
    const trimmedName = name.trim();

    const existing = await prisma.staffLanguage.findFirst({
      where: {
        name: {
          equals: trimmedName,
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      res.json(new AppResponse('Language with this name already exists', {}, 400));
      return;
    }

    const language = await prisma.staffLanguage.create({
      data: {
        name: trimmedName,
      },
    });

    res.json(new AppResponse('Staff language created successfully', language, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getStaffLanguages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search } = req.query;

    const where: any = {};
    if (search && typeof search === 'string' && search.trim() !== '') {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }

    const pagination = getPagination(req);
    const [languages, total] = await Promise.all([
      prisma.staffLanguage.findMany({
        where,
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: [{ name: 'asc' }],
      }),
      prisma.staffLanguage.count({ where }),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Staff languages retrieved successfully', languages, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getStaffLanguageById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid language ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const language = await prisma.staffLanguage.findUnique({
      where: { id },
    });

    if (!language) {
      res.json(new AppResponse('Staff language not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Staff language retrieved successfully', language, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateStaffLanguage = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid language ID format').run(req);
    await body('name').trim().notEmpty().withMessage('Language name cannot be empty').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const { name }: { name: string } = req.body;
    const trimmedName = name.trim();

    const existingLanguage = await prisma.staffLanguage.findUnique({
      where: { id },
    });
    if (!existingLanguage) {
      res.json(new AppResponse('Staff language not found', {}, 404));
      return;
    }

    const duplicate = await prisma.staffLanguage.findFirst({
      where: {
        id: { not: id },
        name: {
          equals: trimmedName,
          mode: 'insensitive',
        },
      },
    });

    if (duplicate) {
      res.json(new AppResponse('Language with this name already exists', {}, 400));
      return;
    }

    const updated = await prisma.staffLanguage.update({
      where: { id },
      data: {
        name: trimmedName,
      },
    });

    res.json(new AppResponse('Staff language updated successfully', updated, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteStaffLanguage = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid language ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const existingLanguage = await prisma.staffLanguage.findUnique({
      where: { id },
    });

    if (!existingLanguage) {
      res.json(new AppResponse('Staff language not found', {}, 404));
      return;
    }

    await prisma.staffLanguage.delete({
      where: { id },
    });

    res.json(new AppResponse('Staff language deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

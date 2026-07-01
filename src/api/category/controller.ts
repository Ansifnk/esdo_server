import { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { name, image }: { name: string; image?: string } = req.body;

    const isExist = await prisma.category.findFirst({
      where: { name: name.trim() },
    });

    if (isExist) {
      res.json(new AppResponse('Category already exists', {}, 400));
      return;
    }

    const category = await prisma.category.create({
      data: {
        name,
        image: image ?? '',
      },
    });

    res.json(new AppResponse('Category created successfully', category, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const { includeSubCategories } = req.query;

    const includeClause = includeSubCategories === 'true'
      ? { subCategories: { orderBy: { createdAt: 'desc' as const } } }
      : undefined;

    const pagination = getPagination(req);
    const [categories, total] = await Promise.all([
      prisma.category.findMany({
        include: includeClause,
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.category.count(),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Categories retrieved successfully', categories, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getCategoryById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid category ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        subCategories: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!category) {
      res.json(new AppResponse('Category not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Category retrieved successfully', category, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid category ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const { name, image } = req.body;

    const existingCategory = await prisma.category.findUnique({
      where: { id },
    });
    if (!existingCategory) {
      res.json(new AppResponse('Category not found', {}, 404));
      return;
    }

    if (name && name.trim() !== existingCategory.name) {
      const isExist = await prisma.category.findFirst({
        where: { name: name.trim() },
      });
      if (isExist) {
        res.json(new AppResponse('Category with this name already exists', {}, 400));
        return;
      }
    }

    const updatedCategory = await prisma.category.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingCategory.name,
        image: image !== undefined ? image : existingCategory.image,
      },
    });

    res.json(new AppResponse('Category updated successfully', updatedCategory, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid category ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;

    const existingCategory = await prisma.category.findUnique({
      where: { id },
    });
    if (!existingCategory) {
      res.json(new AppResponse('Category not found', {}, 404));
      return;
    }

    const subCategoriesCount = await prisma.subCategory.count({
      where: { categoryId: id },
    });
    if (subCategoriesCount > 0) {
      res.json(new AppResponse('Cannot delete a category that has subcategories', {}, 400));
      return;
    }

    await prisma.category.delete({
      where: { id },
    });

    res.json(new AppResponse('Category deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

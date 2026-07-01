import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

export const createSubCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);
    await body('categoryId').isUUID().withMessage('Invalid category ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const { name, image, categoryId }: { name: string; image?: string; categoryId: string } = req.body;

    const parentExists = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!parentExists) {
      res.json(new AppResponse('Parent category not found', {}, 404));
      return;
    }

    const isExist = await prisma.subCategory.findFirst({
      where: {
        name: name.trim(),
        categoryId,
      },
    });

    if (isExist) {
      res.json(new AppResponse('Subcategory with this name already exists in this category', {}, 400));
      return;
    }

    const subCategory = await prisma.subCategory.create({
      data: {
        name,
        image: image ?? '',
        categoryId,
      },
    });

    res.json(new AppResponse('Subcategory created successfully', subCategory, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getSubCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    await query('categoryId').optional().isUUID().withMessage('Invalid category ID filter').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const categoryIdQuery = req.query.categoryId;
    let whereClause: any = {};

    if (categoryIdQuery) {
      whereClause.categoryId = categoryIdQuery as string;
    }

    const pagination = getPagination(req);
    const [subCategories, total] = await Promise.all([
      prisma.subCategory.findMany({
        where: whereClause,
        include: {
          category: true,
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.subCategory.count({ where: whereClause }),
    ]);

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Subcategories retrieved successfully', subCategories, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getSubCategoryById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid subcategory ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const subCategory = await prisma.subCategory.findUnique({
      where: { id },
      include: {
        category: true,
      },
    });

    if (!subCategory) {
      res.json(new AppResponse('Subcategory not found', {}, 404));
      return;
    }

    res.json(new AppResponse('Subcategory retrieved successfully', subCategory, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateSubCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid subcategory ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);
    await body('categoryId').optional().isUUID().withMessage('Invalid category ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const { name, image, categoryId } = req.body;

    const existingSubCategory = await prisma.subCategory.findUnique({
      where: { id },
    });
    if (!existingSubCategory) {
      res.json(new AppResponse('Subcategory not found', {}, 404));
      return;
    }

    let targetCategoryId = existingSubCategory.categoryId;
    if (categoryId !== undefined) {
      const parentExists = await prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!parentExists) {
        res.json(new AppResponse('Category not found', {}, 404));
        return;
      }
      targetCategoryId = categoryId;
    }

    const targetName = name !== undefined ? name.trim() : existingSubCategory.name;

    if (name !== undefined || categoryId !== undefined) {
      const isExist = await prisma.subCategory.findFirst({
        where: {
          id: { not: id },
          name: targetName,
          categoryId: targetCategoryId,
        },
      });
      if (isExist) {
        res.json(new AppResponse('Subcategory with this name already exists in target category', {}, 400));
        return;
      }
    }

    const updatedSubCategory = await prisma.subCategory.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingSubCategory.name,
        image: image !== undefined ? image : existingSubCategory.image,
        categoryId: targetCategoryId,
      },
    });

    res.json(new AppResponse('Subcategory updated successfully', updatedSubCategory, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteSubCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid subcategory ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;

    const existingSubCategory = await prisma.subCategory.findUnique({
      where: { id },
    });
    if (!existingSubCategory) {
      res.json(new AppResponse('Subcategory not found', {}, 404));
      return;
    }

    await prisma.subCategory.delete({
      where: { id },
    });

    res.json(new AppResponse('Subcategory deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

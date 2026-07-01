import { Request, Response } from 'express';
import { check, param } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';
import AppResponse from '../../models/AppResponse';
import validate from '../../utils/validate';
import { generatePresignedPutUrl, generatePresignedGetUrl, buildPublicUrl } from '../../utils/s3';
import {
  MAX_TEMPLATE_IMAGE_UPLOAD_BYTES,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  MAX_WEBSITE_HERO_VIDEO_UPLOAD_BYTES,
} from '../../configs/env';

/**
 * Create a file metadata record and return a pre-signed PUT URL in one step.
 * The frontend uses the returned uploadUrl to PUT the file directly to S3.
 */
export const createFileAndGetUploadUrl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    await check('originalName').notEmpty().withMessage('originalName is required').run(req);
    await check('mimeType').notEmpty().withMessage('mimeType is required').run(req);
    await check('fileSize')
      .isInt({ min: 0 })
      .withMessage('fileSize must be a non-negative integer')
      .run(req);
    await check('directory').optional().isString().withMessage('directory must be a string').run(req);
    await check('prefix').optional().isString().withMessage('prefix must be a string').run(req);

    const validated = validate(req, res, (() => {}) as any);
    if (!validated) return;

    const { originalName, mimeType, fileSize, isPrivate, directory, prefix } = req.body;

    const isPrivateFlag = isPrivate === true;
    const uploadDirectory = ((directory as string) || (prefix as string) || 'uploads').trim();
    const numericFileSize = Number(fileSize);
    const isTemplateImage =
      uploadDirectory.startsWith('templates/') && String(mimeType).startsWith('image/');
    const isWebsiteHeroVideo =
      uploadDirectory === 'website/hero-videos' ||
      uploadDirectory.startsWith('website/hero-videos/') ||
      uploadDirectory === 'website/block-videos' ||
      uploadDirectory.startsWith('website/block-videos/');
    const maxFileSize = isTemplateImage
      ? MAX_TEMPLATE_IMAGE_UPLOAD_BYTES
      : isWebsiteHeroVideo
        ? MAX_WEBSITE_HERO_VIDEO_UPLOAD_BYTES
        : MAX_UPLOAD_FILE_SIZE_BYTES;

    if (numericFileSize > maxFileSize) {
      throw new AppError(
        `File is too large. Maximum allowed size is ${Math.floor(maxFileSize / 1024 / 1024)}MB.`,
        400,
      );
    }

    if (uploadDirectory.startsWith('templates/') && !String(mimeType).startsWith('image/')) {
      throw new AppError('Template uploads must be image files', 400);
    }

    if (isWebsiteHeroVideo) {
      const isMp4 =
        String(mimeType).toLowerCase() === 'video/mp4' ||
        String(originalName).toLowerCase().endsWith('.mp4');
      if (!isMp4) {
        throw new AppError('Hero background video must be an MP4 file', 400);
      }
    }

    const { uploadUrl, s3Path, s3Bucket } = await generatePresignedPutUrl(
      originalName as string,
      mimeType as string,
      isPrivateFlag,
      uploadDirectory || 'uploads',
    );

    const publicUrl = isPrivateFlag ? '' : buildPublicUrl(s3Bucket, s3Path);

    const file = await prisma.file.create({
      data: {
        originalName: originalName as string,
        path: s3Path,
        bucket: s3Bucket,
        isPrivate: isPrivateFlag,
        publicUrl,
        mimeType: mimeType as string,
        fileSize: BigInt(numericFileSize),
        createdBy: req.user?.id,
      },
    });

    res.json(
      new AppResponse(
        'File created',
        {
          ...file,
          fileSize: file.fileSize.toString(),
          uploadUrl,
        },
        201,
      ),
    );
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

/**
 * Get file metadata by ID. For private files, include a pre-signed GET URL.
 */
export const getFileById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').notEmpty().run(req);
    const validated = validate(req, res, (() => {}) as any);
    if (!validated) return;

    const { id } = req.params;

    const file = await prisma.file.findFirst({
      where: { id: id as string, deletedAt: null },
    });

    if (!file) {
      throw new AppError('File not found', 404);
    }

    let accessUrl = file.publicUrl;
    if (file.isPrivate) {
      accessUrl = await generatePresignedGetUrl(file.bucket, file.path);
    }

    res.json(
      new AppResponse('File fetched successfully', {
        ...file,
        fileSize: file.fileSize.toString(),
        accessUrl,
      }),
    );
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

/**
 * Soft delete a file by setting deletedAt.
 */
export const deleteFile = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').notEmpty().run(req);
    const validated = validate(req, res, (() => {}) as any);
    if (!validated) return;

    const { id } = req.params;

    const file = await prisma.file.findFirst({
      where: { id: id as string, deletedAt: null },
    });

    if (!file) {
      throw new AppError('File not found', 404);
    }

    await prisma.file.update({
      where: { id: id as string },
      data: {
        deletedAt: new Date(),
        updatedBy: req.user?.id,
      },
    });

    res.json(new AppResponse('File deleted successfully'));
  } catch (error: any) {
    const status = error instanceof AppError ? error.status : 500;
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, status));
  }
};

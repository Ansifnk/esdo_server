import { Router } from 'express';
import {
  createFileAndGetUploadUrl,
  getFileByIdOrPath,
  getUploadUrlWithoutDB,
  deleteFile,
} from './controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Public routes - wildcard to match relative paths (e.g. categories/abc.jpg)
router.get('/{*id}', getFileByIdOrPath);

// Protected routes (require authenticating a user or customer token)
router.post('/', authenticate, createFileAndGetUploadUrl);
router.post('/upload-url', authenticate, getUploadUrlWithoutDB);
router.delete('/:id', authenticate, deleteFile);

export default router;

import { Router } from 'express';
import {
  createFileAndGetUploadUrl,
  getFileById,
  deleteFile,
} from './controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Protected routes (require authenticating a user or customer token)
router.post('/', authenticate, createFileAndGetUploadUrl);
router.get('/:id', authenticate, getFileById);
router.delete('/:id', authenticate, deleteFile);

export default router;

import { Router } from 'express';
import {
  getReviews,
  createReview,
  getReviewById,
  deleteReview,
} from './controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Public routes
router.get('/', getReviews);
router.get('/:id', getReviewById);

// Protected routes
router.post('/', authenticate, createReview);
router.delete('/:id', authenticate, deleteReview);

export default router;

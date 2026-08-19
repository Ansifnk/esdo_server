import { Router } from 'express';
import { authenticate } from '../../middlewares/auth';
import {
  getCart,
  addToCart,
  removeCartItem,
  applyCoupon,
} from './cartController';

const router = Router();

// Protect all cart routes with customer authentication
router.use(authenticate);

router.get('/', getCart);
router.post('/add', addToCart);
router.delete('/items/:itemId', removeCartItem);
router.post('/coupon', applyCoupon);

export default router;

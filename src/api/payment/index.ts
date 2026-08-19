import { Router } from 'express';
import { createOrder, verifyAndCreateBooking, handleWebhook } from './paymentController';
import { authenticate } from '../../middlewares/auth';

const router = Router();

router.post('/create-order', authenticate, createOrder);
router.post('/verify-and-create-booking', authenticate, verifyAndCreateBooking);
router.post('/webhook', handleWebhook);

export default router;

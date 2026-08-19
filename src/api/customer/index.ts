import { Router } from 'express';
import {
  customerLoginSendOtp,
  customerVerifyOtp,
  customerSignupSendOtp,
} from '../auth/customerController';
import { getCustomers, createCustomer } from './customerController';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Customer OTP Routes
router.post('/login-send-otp', customerLoginSendOtp);
router.post('/verify-otp', customerVerifyOtp);
router.post('/signup-send-otp', customerSignupSendOtp);

// Customer management / search routes
router.get('/', authenticate, getCustomers);
router.post('/', authenticate, createCustomer);

export default router;


import { Router } from 'express';
import {
  customerLoginSendOtp,
  customerVerifyOtp,
  customerSignupSendOtp,
} from '../auth/customerController';

const router = Router();

// Customer OTP Routes
router.post('/login-send-otp', customerLoginSendOtp);
router.post('/verify-otp', customerVerifyOtp);
router.post('/signup-send-otp', customerSignupSendOtp);

export default router;

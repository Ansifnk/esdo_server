import { Router } from 'express';
import {
  customerLoginSendOtp,
  customerVerifyOtp,
  customerSignupSendOtp,
} from '../auth/customerController';
import {
  getCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  updateCustomerBranch,
  updateCustomerProfile,
} from './customerController';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Customer OTP Routes
router.post('/login-send-otp', customerLoginSendOtp);
router.post('/verify-otp', customerVerifyOtp);
router.post('/signup-send-otp', customerSignupSendOtp);

// Customer profile management (Customer self-service)
router.patch('/profile', authenticate, updateCustomerProfile);
router.put('/profile', authenticate, updateCustomerProfile);

// Customer branch / saloon preference
router.patch('/branch', authenticate, updateCustomerBranch);
router.put('/branch', authenticate, updateCustomerBranch);

// Customer management / search / CRUD routes (Admin)
router.get('/', authenticate, getCustomers);
router.post('/', authenticate, createCustomer);
router.get('/:id', authenticate, getCustomerById);
router.put('/:id', authenticate, updateCustomer);
router.patch('/:id', authenticate, updateCustomer);
router.delete('/:id', authenticate, deleteCustomer);

export default router;


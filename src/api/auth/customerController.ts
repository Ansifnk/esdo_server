import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { Role } from '../../generated/prisma/enums';
import {
  createAccessToken,
  createRefreshToken,
  setRefreshTokenCookie,
} from './utils';
import {
  generateOtp,
  storeOtp,
  verifyOtpCode,
  isOtpRateLimited,
  sendOtpSms,
  normalizePhone,
} from '../../utils/otp';

/**
 * Customer Login - Send OTP
 * Route: POST /api/auth/customer/login-send-otp (or /api/customer/login-send-otp)
 */
export const customerLoginSendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone } = req.body;

    if (!phone) {
      throw new AppError('Phone number is required', 400);
    }

    const normalized = normalizePhone(phone);

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { phone: normalized },
    });

    if (!customer) {
      throw new AppError('Account not found with this phone number. Please register first.', 404);
    }

    // Rate limit check
    if (await isOtpRateLimited(normalized, 30)) {
      throw new AppError('Please wait 30 seconds before requesting another OTP', 429);
    }

    // Generate & store OTP
    const otp = generateOtp(4);
    await storeOtp(normalized, otp);

    // Send OTP SMS
    await sendOtpSms(normalized, otp);

    res.json(
      new AppResponse('OTP sent successfully', {
        phone: normalized,
        // Include OTP in dev mode for easy testing
        ...(process.env.NODE_ENV === 'development' ? { devOtp: otp } : {}),
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, statusCode));
  }
};

/**
 * Customer Verify OTP (Handles both Login & Quick Signup Verification)
 * Route: POST /api/auth/customer/verify-otp (or /api/customer/verify-otp)
 */
export const customerVerifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, otp, name } = req.body;

    if (!phone || !otp) {
      throw new AppError('Phone number and OTP code are required', 400);
    }

    const normalized = normalizePhone(phone);

    // Verify OTP code using shared utility
    const otpResult = await verifyOtpCode(normalized, otp);
    if (!otpResult.valid) {
      throw new AppError(otpResult.message || 'Invalid OTP', 400);
    }

    // Find or create customer
    let customer = await prisma.customer.findUnique({
      where: { phone: normalized },
    });

    if (!customer) {
      // Auto-create customer record on verification
      customer = await prisma.customer.create({
        data: {
          phone: normalized,
          name: name || `Customer ${normalized.slice(-4)}`,
        },
      });
    }

    // Generate Session & JWT Tokens
    const sessionId = crypto.randomUUID();
    const { password: _, ...customerPayload } = customer;

    const accessToken = createAccessToken(
      { id: customer.id, email: customer.email || '', name: customer.name || '' },
      sessionId,
      Role.CUSTOMER
    );
    const refreshToken = createRefreshToken(customer.id, sessionId);

    // Set Refresh Token in HTTP-only Cookie
    setRefreshTokenCookie(res, req, refreshToken);

    res.json(
      new AppResponse('Authentication successful', {
        customer: customerPayload,
        accessToken,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, statusCode));
  }
};

/**
 * Customer Signup - Send OTP (Reusable for Signup Flow)
 * Route: POST /api/auth/customer/signup-send-otp
 */
export const customerSignupSendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, name, email } = req.body;

    if (!phone) {
      throw new AppError('Phone number is required for signup', 400);
    }

    const normalized = normalizePhone(phone);

    // Check if customer already exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { phone: normalized },
    });

    if (existingCustomer) {
      throw new AppError('This phone number is already registered. Please log in.', 400);
    }

    // Check rate limit
    if (await isOtpRateLimited(normalized, 30)) {
      throw new AppError('Please wait 30 seconds before requesting another OTP', 429);
    }

    // Generate & store OTP
    const otp = generateOtp(4);
    await storeOtp(normalized, otp);

    // Send OTP SMS
    await sendOtpSms(normalized, otp);

    res.json(
      new AppResponse('Signup OTP sent successfully', {
        phone: normalized,
        name,
        email,
        ...(process.env.NODE_ENV === 'development' ? { devOtp: otp } : {}),
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, statusCode));
  }
};

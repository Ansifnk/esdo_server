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
import { generateUniqueReferralCode } from '../rewards/rewardUtils';
import { referralService } from '../rewards/referralService';

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
    const { phone, otp, name, email, address, birthDate } = req.body;

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
      include: { defaultSaloon: true },
    });

    const referralCodeInput = req.body.referredByCode || req.body.referralCode;
    const requestedSaloonId = req.body.defaultSaloonId || req.body.saloonId;

    const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
    let parsedBirthDate: Date | null = null;
    if (birthDate) {
      const d = new Date(birthDate);
      if (!isNaN(d.getTime())) {
        parsedBirthDate = d;
      }
    }
    const cleanAddress = address && typeof address === 'string' && address.trim() !== '' ? address.trim() : null;

    if (!customer) {
      const generatedCode = await generateUniqueReferralCode();
      // Auto-create customer record on verification
      customer = await prisma.customer.create({
        data: {
          phone: normalized,
          name: name || `Customer ${normalized.slice(-4)}`,
          email: cleanEmail,
          birthDate: parsedBirthDate,
          address: cleanAddress,
          referralCode: generatedCode,
          defaultSaloonId: requestedSaloonId || null,
        },
        include: { defaultSaloon: true },
      });

      // Apply referral code if provided
      if (referralCodeInput) {
        try {
          await referralService.applyReferralCode(customer.id, referralCodeInput);
        } catch (err: any) {
          console.warn('Could not apply referral code during customer verification:', err.message);
        }
      }
    } else {
      const updateData: any = {};
      if (!customer.referralCode) {
        updateData.referralCode = await generateUniqueReferralCode();
      }
      if (requestedSaloonId && !customer.defaultSaloonId) {
        updateData.defaultSaloonId = requestedSaloonId;
      }
      if (name && (!customer.name || customer.name.startsWith('Customer '))) {
        updateData.name = name;
      }
      if (cleanEmail && !customer.email) {
        updateData.email = cleanEmail;
      }
      if (parsedBirthDate && !customer.birthDate) {
        updateData.birthDate = parsedBirthDate;
      }
      if (cleanAddress && !customer.address) {
        updateData.address = cleanAddress;
      }
      if (Object.keys(updateData).length > 0) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: updateData,
          include: { defaultSaloon: true },
        });
      }
    }

    if (!customer) {
      throw new AppError('Failed to process customer account', 500);
    }

    // Generate Session & JWT Tokens
    const sessionId = crypto.randomUUID();
    const { password: _, ...customerPayloadRaw } = customer as any;

    const customerPayload = {
      ...customerPayloadRaw,
      saloonId: customer.defaultSaloonId,
      saloon: customer.defaultSaloon,
      address: customer.address || '',
    };

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

    // If email provided, check if already in use
    const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
    if (cleanEmail) {
      const existingEmail = await prisma.customer.findUnique({
        where: { email: cleanEmail },
      });
      if (existingEmail) {
        throw new AppError('This email is already registered. Please use another email or log in.', 400);
      }
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
        email: cleanEmail,
        ...(process.env.NODE_ENV === 'development' ? { devOtp: otp } : {}),
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, statusCode));
  }
};

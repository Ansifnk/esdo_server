import crypto from 'crypto';
import { prisma } from '../lib/prisma';

/**
 * Clean and normalize phone number string
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If 10 digit Indian number, append country code 91
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

/**
 * Generate a random numeric OTP of specified length (default 4 digits)
 */
export function generateOtp(length: number = 4): string {
  // In development, default to '1234' if specified or generate random digits
  if (process.env.NODE_ENV === 'development' && process.env.USE_STATIC_OTP === 'true') {
    return '1234';
  }
  
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += crypto.randomInt(0, 10).toString();
  }
  return otp;
}

/**
 * Store OTP for a phone number in database with expiration time (default 5 minutes)
 */
export async function storeOtp(phone: string, otp: string, ttlSeconds: number = 300): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await prisma.otp.upsert({
    where: { phone: normalizedPhone },
    update: {
      otp,
      expiresAt,
      attempts: 0,
      lastSentAt: now,
    },
    create: {
      phone: normalizedPhone,
      otp,
      expiresAt,
      attempts: 0,
      lastSentAt: now,
    },
  });
}

/**
 * Check if requesting OTP for a phone number is rate limited (cooldown)
 */
export async function isOtpRateLimited(phone: string, cooldownSeconds: number = 30): Promise<boolean> {
  const normalizedPhone = normalizePhone(phone);
  const record = await prisma.otp.findUnique({
    where: { phone: normalizedPhone },
  });
  if (!record) return false;

  const elapsedSeconds = (Date.now() - record.lastSentAt.getTime()) / 1000;
  return elapsedSeconds < cooldownSeconds;
}

/**
 * Verify input OTP code against stored database record
 */
export async function verifyOtpCode(phone: string, inputOtp: string): Promise<{ valid: boolean; message?: string }> {
  const normalizedPhone = normalizePhone(phone);
  const record = await prisma.otp.findUnique({
    where: { phone: normalizedPhone },
  });

  if (!record) {
    return { valid: false, message: 'OTP expired or not requested. Please request a new OTP.' };
  }

  if (Date.now() > record.expiresAt.getTime()) {
    await prisma.otp.delete({ where: { phone: normalizedPhone } }).catch(() => {});
    return { valid: false, message: 'OTP has expired. Please request a new one.' };
  }

  if (record.attempts >= 5) {
    await prisma.otp.delete({ where: { phone: normalizedPhone } }).catch(() => {});
    return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' };
  }

  // Increment attempt count
  await prisma.otp.update({
    where: { phone: normalizedPhone },
    data: { attempts: { increment: 1 } },
  });

  // Allow static dev fallback '1234' in development environment
  const isMatch = inputOtp === record.otp || (process.env.NODE_ENV === 'development' && inputOtp === '1234');

  if (!isMatch) {
    return { valid: false, message: 'Invalid OTP code. Please check and try again.' };
  }

  // Clear OTP on successful verification
  await prisma.otp.delete({ where: { phone: normalizedPhone } }).catch(() => {});
  return { valid: true };
}

/**
 * Send OTP SMS helper (logs to console in dev mode, extensible for SMS gateway integration)
 */
export async function sendOtpSms(phone: string, otp: string): Promise<{ success: boolean; message?: string }> {
  try {
    const normalizedPhone = normalizePhone(phone);
    console.log(`[OTP SERVICE] Sent OTP [${otp}] to +${normalizedPhone}`);
    
    // Extensible for SMS Gateway (Twilio / MSG91 / Fast2SMS / Firebase)
    // await smsProvider.send({ to: normalizedPhone, text: `Your ESDO verification code is ${otp}` });

    return { success: true, message: 'OTP sent successfully' };
  } catch (error: any) {
    console.error('[OTP SERVICE ERROR]', error);
    return { success: false, message: error.message || 'Failed to send OTP' };
  }
}

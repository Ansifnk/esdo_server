import 'dotenv/config';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const USE_STATIC_OTP = process.env.USE_STATIC_OTP === 'true'
export const MAX_TEMPLATE_IMAGE_UPLOAD_BYTES = Number(process.env.MAX_TEMPLATE_IMAGE_UPLOAD_BYTES) || 5 * 1024 * 1024; // 5MB
export const MAX_UPLOAD_FILE_SIZE_BYTES = Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES) || 20 * 1024 * 1024; // 20MB
export const MAX_WEBSITE_HERO_VIDEO_UPLOAD_BYTES = Number(process.env.MAX_WEBSITE_HERO_VIDEO_UPLOAD_BYTES) || 100 * 1024 * 1024; // 100MB

// Cloudflare R2 Storage Configuration
export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
export const R2_BUCKET = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || '';
export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
export const R2_ENDPOINT =
  process.env.R2_ENDPOINT ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
export const R2_REGION = process.env.R2_REGION || 'auto';

export const PORT = Number(process.env.PORT) || 3000;
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key_id';
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_key_secret';
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_test_webhook_secret';

export const CLIENT_URL = process.env.CLIENT_URL;
export const SMS_API_KEY = process.env.SMS_API_KEY || '';
export const SMS_CLIENT_ID = process.env.SMS_CLIENT_ID || '';
export const SMS_SENDER_ID = process.env.SMS_SENDER_ID || '';
export const SMS_PEID = process.env.SMS_PEID || '';
export const SMS_OTP_TEMPLATE_ID = process.env.SMS_OTP_TEMPLATE_ID || '';
export const SMS_BOOKING_DETAILS_TEMPLATE_ID = process.env.SMS_BOOKING_DETAILS_TEMPLATE_ID || '';
export const SMS_TEMPLATE_API_URL = process.env.SMS_TEMPLATE_API_URL || 'https://sendsms.stmtechnologies.com/api/v2/SendSMS';


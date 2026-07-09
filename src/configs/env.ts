import 'dotenv/config';

export const MAX_TEMPLATE_IMAGE_UPLOAD_BYTES = Number(process.env.MAX_TEMPLATE_IMAGE_UPLOAD_BYTES) || 5 * 1024 * 1024; // 5MB
export const MAX_UPLOAD_FILE_SIZE_BYTES = Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES) || 20 * 1024 * 1024; // 20MB
export const MAX_WEBSITE_HERO_VIDEO_UPLOAD_BYTES = Number(process.env.MAX_WEBSITE_HERO_VIDEO_UPLOAD_BYTES) || 100 * 1024 * 1024; // 100MB

export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
export const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
export const AWS_PUBLIC_S3_URL = process.env.AWS_PUBLIC_S3_URL || '';

export const PORT = Number(process.env.PORT) || 3000;
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '';


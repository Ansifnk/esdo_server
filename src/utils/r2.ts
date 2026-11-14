import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,
  R2_ENDPOINT,
  R2_REGION,
} from '../configs/env';

const endpoint =
  R2_ENDPOINT ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

export const r2Client = new S3Client({
  region: R2_REGION || 'auto',
  ...(endpoint ? { endpoint } : {}),
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Generate a pre-signed PUT URL for uploading directly to Cloudflare R2.
 */
export const generatePresignedPutUrl = async (
  originalName: string,
  mimeType: string,
  isPrivate: boolean,
  directory: string,
  savePath?: string,
) => {
  const extension = originalName.split('.').pop() || '';
  let path = '';

  if (savePath) {
    // If savePath already starts with the directory name, use it directly.
    // Otherwise, prepend the directory prefix.
    if (directory && !savePath.startsWith(`${directory}/`)) {
      path = `${directory}/${savePath}`;
    } else {
      path = savePath;
    }
  } else {
    const uuid = crypto.randomUUID();
    path = `${directory}/${uuid}${extension ? `.${extension}` : ''}`;
  }

  const bucket = R2_BUCKET;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

  return {
    uploadUrl,
    path,
    bucket,
  };
};

/**
 * Generate a pre-signed GET URL for reading/downloading private objects.
 */
export const generatePresignedGetUrl = async (bucket: string, path: string) => {
  const command = new GetObjectCommand({
    Bucket: bucket || R2_BUCKET,
    Key: path,
  });

  return await getSignedUrl(r2Client, command, { expiresIn: 3600 });
};

/**
 * Build a public access URL for public files in Cloudflare R2.
 */
export const buildPublicUrl = (bucket: string, path: string): string => {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${cleanPath}`;
  }
  if (endpoint) {
    return `${endpoint.replace(/\/$/, '')}/${bucket}/${cleanPath}`;
  }
  return `https://${bucket}.r2.cloudflarestorage.com/${cleanPath}`;
};


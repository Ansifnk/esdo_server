import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  AWS_S3_BUCKET,
  AWS_PUBLIC_S3_URL,
} from '../configs/env';

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Generate a pre-signed PUT URL.
 */
export const generatePresignedPutUrl = async (
  originalName: string,
  mimeType: string,
  isPrivate: boolean,
  directory: string,
) => {
  const extension = originalName.split('.').pop() || '';
  const uuid = crypto.randomUUID();
  const path = `${directory}/${uuid}${extension ? `.${extension}` : ''}`;
  const bucket = AWS_S3_BUCKET;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return { uploadUrl, s3Path: path, s3Bucket: bucket };
};

/**
 * Generate a pre-signed GET URL.
 */
export const generatePresignedGetUrl = async (bucket: string, path: string) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: path,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

/**
 * Build a public access URL for public files.
 */
export const buildPublicUrl = (bucket: string, path: string): string => {
  if (AWS_PUBLIC_S3_URL) {
    return `${AWS_PUBLIC_S3_URL.replace(/\/$/, '')}/${path}`;
  }
  return `https://${bucket}.s3.${AWS_REGION}.amazonaws.com/${path}`;
};

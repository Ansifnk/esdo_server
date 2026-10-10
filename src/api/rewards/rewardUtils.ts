import * as crypto from 'crypto';
import { prisma } from '../../lib/prisma';

/**
 * Generate a unique 6-character alphanumeric referral code (e.g. 1E9BS3)
 * Omits easily confused characters (0, O, 1, I).
 */
export function generateRandomCode(length: number = 6): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Ensures a unique referral code is generated that does not clash in the database.
 */
export async function generateUniqueReferralCode(): Promise<string> {
  let isUnique = false;
  let code = '';
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    code = generateRandomCode(6);
    const existing = await prisma.customer.findUnique({
      where: { referralCode: code },
    });
    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  return code;
}

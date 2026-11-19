import { prisma } from '../lib/prisma';

/**
 * Clean and normalize phone number string.
 * Strips non-digits, trims leading 0 if 11 digits, and prepends 91 for 10-digit Indian numbers.
 * e.g. "9481048337" -> "919481048337"
 *      "+91 9481048337" -> "919481048337"
 *      "09481048337" -> "919481048337"
 */
export function normalizePhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

/**
 * Generate all common formatting variants of a phone number
 * to support searching across legacy and newly imported database records.
 */
export function getPhoneLookupVariants(phone: string): string[] {
  if (!phone || typeof phone !== 'string') return [];
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  let core10 = digits;
  if (digits.length === 11 && digits.startsWith('0')) {
    core10 = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    core10 = digits.slice(2);
  } else if (digits.length > 10) {
    core10 = digits.slice(-10);
  }

  const variants = new Set<string>();
  if (trimmed) variants.add(trimmed);
  if (digits) variants.add(digits);

  if (core10.length === 10) {
    variants.add(`91${core10}`);
    variants.add(core10);
    variants.add(`+91${core10}`);
    variants.add(`+91 ${core10}`);
    variants.add(`+91-${core10}`);
    variants.add(`0${core10}`);
  }

  return Array.from(variants).filter(Boolean);
}

/**
 * Finds a customer record by phone number supporting:
 * - exact normalized phone ("919481048337")
 * - 10-digit phone ("9481048337")
 * - formatted phone ("+91 9481048337", "+919481048337", "+91-9481048337", "09481048337")
 * - fallback ending with 10 digits
 *
 * Automatically heals (updates) non-standard phone numbers in the database
 * to the clean standard format `91XXXXXXXXXX`.
 */
export async function findCustomerByPhone(
  phone: string,
  options?: {
    include?: any;
    autoHeal?: boolean;
  }
) {
  if (!phone || typeof phone !== 'string') return null;

  const { include, autoHeal = true } = options || {};
  const standardPhone = normalizePhone(phone);
  const variants = getPhoneLookupVariants(phone);

  // 1. Try finding by any matching variant
  let customer = await prisma.customer.findFirst({
    where: {
      phone: { in: variants },
    },
    ...(include ? { include } : {}),
  });

  // 2. Fallback: if not found, search by last 10 digits
  const digits = phone.replace(/\D/g, '');
  const core10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!customer && core10.length === 10) {
    customer = await prisma.customer.findFirst({
      where: {
        phone: { endsWith: core10 },
      },
      ...(include ? { include } : {}),
    });
  }

  // 3. Auto-heal: update legacy formatted phone to standardized normalized phone
  if (customer && autoHeal && standardPhone && customer.phone !== standardPhone) {
    try {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { phone: standardPhone },
        ...(include ? { include } : {}),
      });
    } catch {
      // Ignore unique collision or failure, keep existing customer
    }
  }

  return customer;
}

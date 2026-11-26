import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';

/**
 * Derive Indian Financial Year (e.g., "2026-27") for a given date.
 * Financial Year starts April 1 (month index 3).
 */
export function getFinancialYear(date: Date = new Date()): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

/**
 * Determine the next invoice number based on booking source and financial year.
 * Format:
 *  - Online (Website):  esdo_2026-27_1700, esdo_2026-27_1701...
 *  - Offline (Admin):   ESDO_2026-27_1700, ESDO_2026-27_1701...
 * Starts with 1700 for each channel and continuously increments across financial years.
 */
export async function getNextInvoiceNumber(
  source: 'ADMIN' | 'WEBSITE' | string,
  date: Date = new Date(),
  tx: any = prisma
): Promise<string> {
  const isAdmin = typeof source === 'string' && source.trim().toUpperCase() === 'ADMIN';
  const prefix = isAdmin ? 'ESDO' : 'esdo';
  const fy = getFinancialYear(date);
  const searchPrefix = `${prefix}_`;

  // Find all existing invoices for this specific channel prefix across all years
  const existingInvoices = await tx.invoice.findMany({
    where: {
      invoiceNumber: {
        startsWith: searchPrefix,
      },
    },
    select: { invoiceNumber: true },
  });

  let maxSeq = 1699; // Starts with 1700 (1699 + 1)
  const seqRegex = new RegExp(`^${prefix}_\\d{4}-\\d{2}_(\\d+)$`);

  for (const inv of existingInvoices) {
    const match = inv.invoiceNumber.match(seqRegex);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${prefix}_${fy}_${nextSeq}`;
}

/**
 * Returns true when a booking was paid entirely using membership balance
 * (no invoice should be generated for such bookings).
 */
export function isMembershipOnlyBooking(booking: {
  paymentMode?: string | null;
  membershipUsed?: number | null;
  totalAmount?: number | null;
}): boolean {
  const mode = typeof booking.paymentMode === 'string' ? booking.paymentMode.trim().toUpperCase() : '';
  if (mode === 'MEMBERSHIP') {
    return true;
  }
  return Number(booking.membershipUsed || 0) > 0 && Number(booking.totalAmount || 0) === 0;
}

/**
 * Generate or retrieve an invoice for a completed booking
 */
export async function generateOrGetInvoiceForBooking(bookingId: string) {
  // Check if invoice already exists for this booking
  const existingInvoice = await prisma.invoice.findUnique({
    where: { bookingId },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      saloon: true,
      booking: true,
    },
  });

  if (existingInvoice) {
    return existingInvoice;
  }

  // Fetch booking details
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      saloon: true,
      items: {
        include: {
          service: true,
          package: true,
          staff: true,
        },
      },
      payment: true,
    },
  });

  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
    throw new AppError('Invoice can only be generated for confirmed bookings', 400);
  }

  if (!booking.customerId) {
    throw new AppError('Invoice can only be generated for bookings with a customer', 400);
  }

  if (booking.paymentStatus !== 'SUCCESS') {
    throw new AppError('Invoice can only be generated for paid bookings', 400);
  }

  if (isMembershipOnlyBooking(booking)) {
    throw new AppError('Invoices are not generated for bookings paid with membership balance', 400);
  }

  // Snapshot item details - store standard ISO strings in database
  const itemSnapshots = (booking.items || []).map((item) => {
    const actualPrice = Math.round((Number(item.service?.price ?? item.package?.price ?? item.price) || 0) * 100) / 100;
    const price = Math.round((Number(item.price) || 0) * 100) / 100;
    const discountAmount = Math.max(0, Math.round((actualPrice - price) * 100) / 100);
    return {
      id: item.id,
      name: item.service?.name || item.package?.name || 'Appointment Item',
      type: item.packageId ? 'Package' : 'Service',
      sacCode: item.service?.sacCode || null,
      staffName: item.staff?.name || null,
      date: item.date || new Date().toISOString(),
      timeSlot: item.timeSlot || '',
      actualPrice,
      discountAmount,
      price,
    };
  });

  // Create invoice record with retry logic for unique constraint race condition
  let attempts = 0;
  let newInvoice: any;

  while (attempts < 5) {
    attempts++;
    const invoiceNumber = await getNextInvoiceNumber(
      booking.source || 'WEBSITE',
      booking.createdAt || new Date()
    );

    try {
      newInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          bookingId: booking.id,
          customerId: booking.customerId,
          saloonId: booking.saloonId || null,
          subtotal: booking.subtotal,
          discount: booking.discount,
          couponDiscount: booking.couponDiscount ?? 0,
          rewardDiscount: booking.rewardDiscount ?? 0,
          totalAmount: booking.totalAmount,
          items: itemSnapshots,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          saloon: true,
          booking: true,
        },
      });
      break;
    } catch (err: any) {
      if (err.code === 'P2002') {
        const target = err.meta?.target;
        const targetStr = Array.isArray(target) ? target.join(',') : String(target || '');

        if (targetStr.includes('bookingId')) {
          const alreadyCreated = await prisma.invoice.findUnique({
            where: { bookingId },
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
              saloon: true,
              booking: true,
            },
          });
          if (alreadyCreated) return alreadyCreated;
        }

        if (targetStr.includes('invoiceNumber') && attempts < 5) {
          continue;
        }
      }
      throw err;
    }
  }

  return newInvoice;
}

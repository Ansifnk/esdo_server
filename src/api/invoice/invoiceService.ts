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
 *  - Website: esdo_2026-27_1600
 *  - Admin:   ESDO_2026-27_1600
 * Starts with 1600 then increments.
 */
export async function getNextInvoiceNumber(
  source: 'ADMIN' | 'WEBSITE' | string,
  date: Date = new Date(),
  tx: any = prisma
): Promise<string> {
  const prefix = source === 'ADMIN' ? 'ESDO' : 'esdo';
  const fy = getFinancialYear(date);

  // Find all existing invoices for this financial year
  const existingInvoices = await tx.invoice.findMany({
    where: {
      invoiceNumber: {
        contains: `_${fy}_`,
        mode: 'insensitive',
      },
    },
    select: { invoiceNumber: true },
  });

  let maxSeq = 1599; // Starts with 1600 (1599 + 1)
  const seqRegex = /(?:esdo|ESDO)_\d{4}-\d{2}_(\d+)/i;

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

  if (booking.paymentStatus !== 'SUCCESS') {
    throw new AppError('Invoice can only be generated for paid bookings', 400);
  }

  // Snapshot item details - store standard ISO strings in database
  const itemSnapshots = (booking.items || []).map((item) => ({
    id: item.id,
    name: item.service?.name || item.package?.name || 'Appointment Item',
    type: item.packageId ? 'Package' : 'Service',
    sacCode: item.service?.sacCode || null,
    staffName: item.staff?.name || null,
    date: item.date || new Date().toISOString(),
    timeSlot: item.timeSlot || '',
    price: item.price,
  }));

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

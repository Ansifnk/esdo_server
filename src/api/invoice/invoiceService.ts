import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';

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

  if (booking.paymentStatus !== 'SUCCESS') {
    throw new AppError('Invoice can only be generated for bookings with completed payment', 400);
  }

  // Construct unique invoice number
  const invoiceNumber = `INV-${booking.bookingNumber.startsWith('BK-') ? booking.bookingNumber.substring(3) : booking.bookingNumber}`;

  // Snapshot item details
  const itemSnapshots = (booking.items || []).map((item) => ({
    id: item.id,
    name: item.service?.name || item.package?.name || 'Appointment Item',
    type: item.packageId ? 'Package' : 'Service',
    staffName: item.staff?.name || null,
    date: item.date || '',
    timeSlot: item.timeSlot || '',
    price: item.price,
  }));

  // Create invoice record
  const newInvoice = await prisma.invoice.create({
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

  return newInvoice;
}

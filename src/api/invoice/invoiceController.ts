import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { generateOrGetInvoiceForBooking } from './invoiceService';

/**
 * GET /api/invoices/booking/:bookingId
 * Get or generate invoice for a booking
 */
export const getInvoiceByBookingId = async (req: Request, res: Response): Promise<void> => {
  try {
    const bookingIdStr = String(req.params.bookingId);

    if (!bookingIdStr) {
      throw new AppError('Booking ID is required', 400);
    }

    const invoice = await generateOrGetInvoiceForBooking(bookingIdStr);

    res.json(new AppResponse('Invoice retrieved successfully', invoice));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve invoice', {}, statusCode));
  }
};

/**
 * GET /api/invoices/:id
 * Get single invoice by ID
 */
export const getInvoiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: String(id) },
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
        booking: {
          include: {
            items: {
              include: {
                service: true,
                package: true,
                staff: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    res.json(new AppResponse('Invoice details retrieved successfully', invoice));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve invoice', {}, statusCode));
  }
};

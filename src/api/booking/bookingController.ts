import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { getPagination, getPaginationMeta } from '../../utils/pagination';

/**
 * GET /api/bookings (Customer)
 * Get bookings for current authenticated customer
 */
export const getCustomerBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const bookings = await prisma.booking.findMany({
      where: { customerId: userId },
      include: {
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
        },
        saloon: true,
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(new AppResponse('Bookings retrieved successfully', bookings));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve bookings', {}, statusCode));
  }
};

/**
 * GET /api/bookings/:id (Customer)
 * Get single booking by ID for current authenticated customer
 */
export const getCustomerBookingById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const { id } = req.params;

    const booking = await prisma.booking.findFirst({
      where: { id: String(id), customerId: userId },
      include: {
        customer: true,
        saloon: true,
        payment: true,
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
        },
      },
    });

    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    res.json(new AppResponse('Booking details retrieved successfully', booking));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve booking', {}, statusCode));
  }
};

/**
 * GET /api/bookings (Admin)
 * Get bookings for admin with filtering and pagination
 */
export const getAdminBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const roles = (req.user?.roles || []).map((r: any) => r.role);
    const isAdmin = roles.includes('ADMIN');
    const isSuperAdmin = roles.includes('SUPER_ADMIN');

    const {
      search = '',
      status,
      saloonId,
      date,
    } = req.query;

    const paginationParams = getPagination(req, 10);
    const where: any = {};
    const andConditions: any[] = [];

    // Saloon scoping: Admin gets locked to their saloon unless Super Admin
    if (isAdmin && !isSuperAdmin) {
      const userSaloonId = (req.user as any)?.saloonId;
      if (userSaloonId) {
        where.saloonId = userSaloonId;
      }
    } else if (saloonId && typeof saloonId === 'string' && saloonId.trim() !== '') {
      where.saloonId = saloonId;
    }

    if (status && typeof status === 'string' && status.trim() !== '') {
      where.status = status;
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim();
      andConditions.push({
        OR: [
          { bookingNumber: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { customer: { phone: { contains: q, mode: 'insensitive' } } },
          { customer: { email: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    if (date && typeof date === 'string' && date.trim() !== '') {
      const targetDateStr = date.trim();
      const startOfDay = new Date(`${targetDateStr}T00:00:00.000Z`);
      const endOfDay = new Date(`${targetDateStr}T23:59:59.999Z`);

      andConditions.push({
        OR: [
          {
            items: {
              some: {
                date: {
                  contains: targetDateStr,
                  mode: 'insensitive',
                },
              },
            },
          },
          {
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          saloon: true,
          payment: true,
          items: {
            include: {
              service: true,
              package: true,
              staff: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: paginationParams.offset,
        take: paginationParams.limit,
      }),
      prisma.booking.count({ where }),
    ]);

    const paginationMeta = getPaginationMeta(total, paginationParams);

    res.json(new AppResponse('Bookings retrieved successfully', bookings, 200, paginationMeta));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve bookings', {}, statusCode));
  }
};

/**
 * GET /api/bookings/:id (Admin)
 * Get single booking by ID for Admin
 */
export const getAdminBookingById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findFirst({
      where: { id: String(id) },
      include: {
        customer: true,
        saloon: true,
        payment: true,
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
        },
      },
    });

    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    res.json(
      new AppResponse('Booking details retrieved successfully', {
        booking,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve booking', {}, statusCode));
  }
};

/**
 * GET /api/bookings
 * Route handler dispatching to getCustomerBookings or getAdminBookings based on role
 */
export const getBookings = async (req: Request, res: Response): Promise<void> => {
  const roles = (req.user?.roles || []).map((r: any) => r.role);
  if (roles.includes('CUSTOMER')) {
    return getCustomerBookings(req, res);
  }
  return getAdminBookings(req, res);
};

/**
 * GET /api/bookings/:id
 * Route handler dispatching to getCustomerBookingById or getAdminBookingById based on role
 */
export const getBookingById = async (req: Request, res: Response): Promise<void> => {
  const roles = (req.user?.roles || []).map((r: any) => r.role);
  if (roles.includes('CUSTOMER')) {
    return getCustomerBookingById(req, res);
  }
  return getAdminBookingById(req, res);
};

/**
 * PUT /api/bookings/:id/status
 * Update status and/or paymentStatus of a booking (Admin only)
 */
export const updateBookingStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, paymentStatus } = req.body;

    const existing = await prisma.booking.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Booking not found', 404);
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;

    const updatedBooking = await prisma.booking.update({
      where: { id: String(id) },
      data: updateData,
      include: {
        customer: true,
        saloon: true,
        payment: true,
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
        },
      },
    });

    res.json(
      new AppResponse('Booking status updated successfully', {
        booking: updatedBooking,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to update booking status', {}, statusCode));
  }
};

/**
 * POST /api/bookings/admin
 * Create a new booking manually from Admin side
 */
export const createAdminBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      saloonId,
      items,
      status = 'CONFIRMED',
      paymentStatus = 'SUCCESS',
      discount = 0,
      couponCode = '',
    } = req.body;

    const roles = (req.user?.roles || []).map((r: any) => r.role);
    const isAdmin = roles.includes('ADMIN');
    const isSuperAdmin = roles.includes('SUPER_ADMIN');

    // Determine target saloonId
    let targetSaloonId = saloonId;
    if (isAdmin && !isSuperAdmin) {
      targetSaloonId = (req.user as any)?.saloonId || saloonId;
    }

    if (!targetSaloonId) {
      // Pick first saloon if none provided
      const firstSaloon = await prisma.saloon.findFirst();
      if (firstSaloon) {
        targetSaloonId = firstSaloon.id;
      } else {
        throw new AppError('Saloon ID is required to create a booking', 400);
      }
    }

    // Determine or Create Customer
    let targetCustomerId = customerId;

    if (!targetCustomerId) {
      if (!customerPhone && !customerEmail && !customerName) {
        throw new AppError('Customer details (Name, Phone or Email) are required', 400);
      }

      // Check if existing customer matches phone or email
      let existingCustomer = null;
      if (customerPhone) {
        existingCustomer = await prisma.customer.findUnique({ where: { phone: customerPhone } });
      }
      if (!existingCustomer && customerEmail) {
        existingCustomer = await prisma.customer.findUnique({ where: { email: customerEmail } });
      }

      if (existingCustomer) {
        targetCustomerId = existingCustomer.id;
      } else {
        // Create new customer
        const newCustomer = await prisma.customer.create({
          data: {
            name: customerName || 'Walk-in Customer',
            phone: customerPhone || null,
            email: customerEmail || null,
          },
        });
        targetCustomerId = newCustomer.id;
      }
    }

    // Validate Items
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('Booking must contain at least one item (service or package)', 400);
    }

    // Process & calculate prices for items
    let subtotal = 0;
    const processedItems = [];

    for (const item of items) {
      let price = Number(item.price) || 0;

      if (!price && item.serviceId) {
        const srv = await prisma.service.findUnique({ where: { id: item.serviceId } });
        if (srv) {
          price = srv.discountPrice > 0 ? srv.discountPrice : srv.price;
        }
      } else if (!price && item.packageId) {
        const pkg = await prisma.package.findUnique({ where: { id: item.packageId } });
        if (pkg) {
          price = pkg.discountPrice > 0 ? pkg.discountPrice : pkg.price;
        }
      }

      subtotal += price;
      processedItems.push({
        serviceId: item.serviceId || null,
        packageId: item.packageId || null,
        staffId: item.staffId || null,
        date: item.date || '',
        timeSlot: item.timeSlot || '',
        price,
      });
    }

    const numericDiscount = Math.min(Math.max(0, Number(discount) || 0), subtotal);
    const totalAmount = Math.max(0, subtotal - numericDiscount);

    const bookingNumber = `BK-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newBooking = await prisma.booking.create({
      data: {
        bookingNumber,
        customerId: targetCustomerId,
        saloonId: targetSaloonId,
        status,
        paymentStatus,
        subtotal,
        discount: numericDiscount,
        totalAmount,
        couponCode: couponCode || '',
        items: {
          create: processedItems,
        },
      },
      include: {
        customer: true,
        saloon: true,
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
        },
      },
    });

    res.json(
      new AppResponse('Booking created successfully', {
        booking: newBooking,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to create booking', {}, statusCode));
  }
};


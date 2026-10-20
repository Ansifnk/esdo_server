import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { getPagination, getPaginationMeta } from '../../utils/pagination';
import { BookingStatus, PaymentStatus, PaymentMode } from '../../generated/prisma/enums';
import { generateOrGetInvoiceForBooking } from '../invoice/invoiceService';
import { deductCustomerMembershipBalance, getCustomerMembershipSummary } from '../membership/membershipService';
import { rewardCoinService } from '../rewards/rewardCoinService';

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
            package: {
              include: {
                services: true,
              },
            },
            staff: true,
          },
        },
        saloon: true,
        payment: true,
        invoice: true,
        reviews: {
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                primaryImage: true,
              },
            },
          },
        },
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
        invoice: true,
        items: {
          include: {
            service: true,
            package: {
              include: {
                services: true,
              },
            },
            staff: true,
          },
        },
        reviews: {
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                primaryImage: true,
              },
            },
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
      paymentStatus,
      paymentMode,
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

    if (paymentStatus && typeof paymentStatus === 'string' && paymentStatus.trim() !== '') {
      where.paymentStatus = paymentStatus;
    }

    if (paymentMode && typeof paymentMode === 'string' && paymentMode.trim() !== '') {
      where.paymentMode = paymentMode;
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
          invoice: true,
          items: {
            include: {
              service: true,
              package: {
                include: {
                  services: true,
                },
              },
              staff: true,
            },
          },
          reviews: {
            include: {
              staff: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
              service: {
                select: {
                  id: true,
                  name: true,
                  primaryImage: true,
                },
              },
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
        invoice: true,
        items: {
          include: {
            service: true,
            package: {
              include: {
                services: true,
              },
            },
            staff: true,
          },
        },
        reviews: {
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                primaryImage: true,
              },
            },
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
    const { status, paymentStatus, paymentMode } = req.body;

    const existing = await prisma.booking.findUnique({
      where: { id: String(id) },
    });

    if (!existing) {
      throw new AppError('Booking not found', 404);
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (paymentMode) updateData.paymentMode = paymentMode;

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
            package: {
              include: {
                services: true,
              },
            },
            staff: true,
          },
        },
      },
    });

    if (
      (updatedBooking.status === 'CONFIRMED' || updatedBooking.status === 'COMPLETED') &&
      updatedBooking.paymentStatus === 'SUCCESS'
    ) {
      try {
        await generateOrGetInvoiceForBooking(updatedBooking.id);
      } catch (invErr) {
        console.error('Failed to auto-generate invoice on status update:', invErr);
      }
    }

    if (updatedBooking.status === 'CANCELLED' || updatedBooking.paymentStatus === 'REFUNDED') {
      try {
        await rewardCoinService.reverseOrderCoins(updatedBooking.id);
      } catch (revErr) {
        console.error('Failed to reverse reward coins on cancellation:', revErr);
      }
    }

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
    // Express-validator validation
    await body('customerId')
      .notEmpty().withMessage('Customer ID is required')
      .isString().withMessage('Customer ID must be a string')
      .trim()
      .run(req);
    await body('items')
      .isArray({ min: 1 }).withMessage('Booking must contain at least one item')
      .run(req);
    await body('items.*.date')
      .notEmpty().withMessage('Date is required for each item')
      .isISO8601().withMessage('Date must be a valid ISO 8601 date string')
      .run(req);
    await body('items.*.timeSlot')
      .notEmpty().withMessage('Time slot is required for each item')
      .isString().withMessage('Time slot must be a string')
      .run(req);
    await body('discount')
      .optional()
      .isFloat({ min: 0 }).withMessage('Discount must be a non-negative number')
      .run(req);
    await body('status')
      .optional()
      .isIn(Object.values(BookingStatus)).withMessage(`Invalid booking status. Allowed: ${Object.values(BookingStatus).join(', ')}`)
      .run(req);
    await body('paymentStatus')
      .optional()
      .isIn(Object.values(PaymentStatus)).withMessage(`Invalid payment status. Allowed: ${Object.values(PaymentStatus).join(', ')}`)
      .run(req);
    await body('paymentMode')
      .optional()
      .isIn(Object.values(PaymentMode)).withMessage(`Invalid payment mode. Allowed: ${Object.values(PaymentMode).join(', ')}`)
      .run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const {
      customerId,
      saloonId,
      items,
      status = BookingStatus.CONFIRMED,
      paymentStatus = PaymentStatus.SUCCESS,
      paymentMode = PaymentMode.CASH,
      discount = 0,
      couponCode = '',
      membershipUsed = 0,
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

    // Validate saloon exists
    const saloon = await prisma.saloon.findUnique({
      where: { id: String(targetSaloonId) },
    });
    if (!saloon) {
      throw new AppError('Selected saloon not found', 404);
    }

    // Look up customer — must already exist
    const targetCustomerId = customerId.trim();
    const existingCustomer = await prisma.customer.findUnique({
      where: { id: targetCustomerId },
    });
    if (!existingCustomer) {
      throw new AppError('Customer not found with the provided customerId', 404);
    }

    // Validate Items
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('Booking must contain at least one item (service or package)', 400);
    }

    // Process, validate & calculate prices for items
    let subtotal = 0;
    const processedItems: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object') {
        throw new AppError(`Item #${i + 1} is invalid`, 400);
      }

      const hasService = Boolean(item.serviceId && typeof item.serviceId === 'string' && item.serviceId.trim());
      const hasPackage = Boolean(item.packageId && typeof item.packageId === 'string' && item.packageId.trim());

      if (!hasService && !hasPackage) {
        throw new AppError(`Item #${i + 1} must specify either a valid serviceId or packageId`, 400);
      }

      if (hasService && hasPackage) {
        throw new AppError(`Item #${i + 1} cannot specify both serviceId and packageId`, 400);
      }

      let price = (item.price !== undefined && item.price !== null && !isNaN(Number(item.price)))
        ? Number(item.price)
        : 0;

      if (price < 0) {
        throw new AppError(`Price for item #${i + 1} must be a valid non-negative number`, 400);
      }

      let cleanServiceId: string | null = null;
      let cleanPackageId: string | null = null;

      if (hasService) {
        const serviceIdToLookup = item.serviceId.trim();
        const srv = await prisma.service.findUnique({ where: { id: serviceIdToLookup } });
        if (!srv) {
          throw new AppError(`Service not found for item #${i + 1}`, 404);
        }
        if (srv.saloonId !== targetSaloonId) {
          throw new AppError(`Service '${srv.name}' does not belong to the selected saloon`, 400);
        }
        cleanServiceId = serviceIdToLookup;
        if (price === 0) {
          price = srv.discountPrice > 0 ? srv.discountPrice : srv.price;
        }
      } else if (hasPackage) {
        const packageIdToLookup = item.packageId.trim();
        const pkg = await prisma.package.findUnique({ where: { id: packageIdToLookup } });
        if (!pkg) {
          throw new AppError(`Package not found for item #${i + 1}`, 404);
        }
        if (pkg.saloonId !== targetSaloonId) {
          throw new AppError(`Package '${pkg.name}' does not belong to the selected saloon`, 400);
        }
        cleanPackageId = packageIdToLookup;
        if (price === 0) {
          price = pkg.discountPrice > 0 ? pkg.discountPrice : pkg.price;
        }
      }

      let cleanStaffId: string | null = null;
      if (item.staffId && typeof item.staffId === 'string' && item.staffId.trim()) {
        const staffIdToLookup = item.staffId.trim();
        const staff = await prisma.staff.findUnique({ where: { id: staffIdToLookup } });
        if (!staff) {
          throw new AppError(`Staff member not found for item #${i + 1}`, 404);
        }
        if (staff.saloonId !== targetSaloonId) {
          throw new AppError(`Staff member '${staff.name}' does not belong to the selected saloon`, 400);
        }
        cleanStaffId = staffIdToLookup;
      }

      let formattedDate = new Date().toISOString();
      if (item.date && typeof item.date === 'string' && item.date.trim()) {
        const parsedDate = new Date(item.date.trim());
        if (isNaN(parsedDate.getTime())) {
          throw new AppError(`Invalid date format for item #${i + 1}. Please send a valid ISO date string.`, 400);
        }
        formattedDate = parsedDate.toISOString();
      }

      subtotal += price;
      processedItems.push({
        serviceId: cleanServiceId,
        packageId: cleanPackageId,
        staffId: cleanStaffId,
        date: formattedDate,
        timeSlot: (item.timeSlot && typeof item.timeSlot === 'string') ? item.timeSlot.trim() : '',
        price,
      });
    }

    // Validate Discount
    let numericDiscount = 0;
    if (discount !== undefined && discount !== null) {
      numericDiscount = Number(discount);
      if (isNaN(numericDiscount) || numericDiscount < 0) {
        throw new AppError('Discount must be a valid non-negative number', 400);
      }
      if (numericDiscount > subtotal) {
        throw new AppError('Discount cannot exceed the subtotal amount', 400);
      }
    }

    const balanceAfterDiscount = Math.max(0, subtotal - numericDiscount);

    // Validate and Calculate membership deduction if requested
    let actualMembershipUsed = 0;
    if (membershipUsed !== undefined && membershipUsed !== null) {
      const numMemUsed = Number(membershipUsed);
      if (isNaN(numMemUsed) || numMemUsed < 0) {
        throw new AppError('Membership used amount must be a valid non-negative number', 400);
      }

      if (numMemUsed > 0 && targetCustomerId) {
        const memSummary = await getCustomerMembershipSummary(targetCustomerId);
        if (numMemUsed > memSummary.totalBalance) {
          throw new AppError(`Insufficient membership balance. Customer available balance is ₹${memSummary.totalBalance}`, 400);
        }
        if (numMemUsed > balanceAfterDiscount) {
          throw new AppError('Membership amount used cannot exceed the payable amount after discount', 400);
        }
        actualMembershipUsed = numMemUsed;
      }
    }

    const totalAmount = Math.max(0, balanceAfterDiscount - actualMembershipUsed);
    const bookingNumber = `BK-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const sanitizedCouponCode = typeof couponCode === 'string' ? couponCode.trim() : '';

    const newBooking = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          bookingNumber,
          customerId: targetCustomerId,
          saloonId: targetSaloonId,
          status,
          paymentStatus,
          paymentMode,
          subtotal,
          discount: numericDiscount,
          membershipUsed: actualMembershipUsed,
          totalAmount,
          couponCode: sanitizedCouponCode,
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
              package: {
                include: {
                  services: true,
                },
              },
              staff: true,
            },
          },
        },
      });

      if (actualMembershipUsed > 0) {
        await deductCustomerMembershipBalance(targetCustomerId, actualMembershipUsed, booking.id, tx);
      }

      return booking;
    });

    if (
      (newBooking.status === 'CONFIRMED' || newBooking.status === 'COMPLETED') &&
      newBooking.paymentStatus === 'SUCCESS'
    ) {
      try {
        await generateOrGetInvoiceForBooking(newBooking.id);
      } catch (invErr) {
        console.error('Failed to auto-generate invoice on admin booking create:', invErr);
      }
    }

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


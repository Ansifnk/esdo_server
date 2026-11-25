import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { getPagination, getPaginationMeta } from '../../utils/pagination';
import { BookingStatus, PaymentStatus, PaymentMode, Role, RewardTxType } from '../../generated/prisma/enums';
import { generateOrGetInvoiceForBooking, isMembershipOnlyBooking } from '../invoice/invoiceService';
import { deductCustomerMembershipBalance, getCustomerMembershipSummary } from '../membership/membershipService';
import { rewardCoinService } from '../rewards/rewardCoinService';
import { referralService } from '../rewards/referralService';
import { isStaffSlotAvailable, normalizeTimeSlot, extractDateMatchKey, doSlotRangesOverlap } from '../staff/controller';
import { sendBookingDetailsSms } from '../../utils/smsUtils';

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
      source,
      customerId,
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

    if (customerId && typeof customerId === 'string' && customerId.trim() !== '') {
      where.customerId = customerId.trim();
    }

    if (source && typeof source === 'string' && ['ADMIN', 'WEBSITE'].includes(source.trim())) {
      where.source = source.trim();
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

    const [bookings, total, customerSummary] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              gender: true,
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
      where.customerId
        ? prisma.booking.aggregate({
            where: {
              customerId: where.customerId,
              ...(where.saloonId ? { saloonId: where.saloonId } : {}),
              status: { notIn: ['CANCELLED', 'DUMMY_BOOKING'] },
            },
            _sum: { totalAmount: true },
            _count: { _all: true },
          })
        : Promise.resolve(null),
    ]);

    const paginationMeta = getPaginationMeta(total, paginationParams);
    const meta = customerSummary
      ? {
          totalSpent: Number(customerSummary._sum.totalAmount || 0),
          activeBookingsCount: customerSummary._count._all,
        }
      : undefined;

    res.json(new AppResponse('Bookings retrieved successfully', bookings, 200, paginationMeta, meta));
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
 * Credit spend-earn reward coins and trigger referral qualification for an eligible booking.
 * Safe against duplicate crediting when called across creation and status updates.
 */
async function grantBookingRewardsIfEligible(
  booking: {
    id: string;
    bookingNumber: string;
    customerId: string | null;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    subtotal: number;
    totalAmount: number;
    pointsEarned: number;
  },
  tx: any
): Promise<number> {
  if (
    !booking.customerId ||
    (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) ||
    booking.paymentStatus !== PaymentStatus.SUCCESS
  ) {
    return booking.pointsEarned;
  }

  let pointsEarned = booking.pointsEarned;

  if (pointsEarned === 0) {
    const existingEarnTx = await tx.rewardTransaction.findFirst({
      where: {
        bookingId: booking.id,
        type: RewardTxType.SPEND_EARN,
      },
    });

    if (!existingEarnTx) {
      const earned = await rewardCoinService.calculateCoinsEarned(booking.subtotal);
      if (earned > 0) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { pointsEarned: earned },
        });
        await rewardCoinService.creditCoins({
          customerId: booking.customerId,
          amount: earned,
          type: RewardTxType.SPEND_EARN,
          bookingId: booking.id,
          notes: `Earned from booking ${booking.bookingNumber}`,
          externalTx: tx,
        });
        pointsEarned = earned;
      }
    }
  }

  await referralService.handleBookingCompletion(
    {
      id: booking.id,
      customerId: booking.customerId,
      totalAmount: booking.totalAmount,
    },
    tx
  );

  return pointsEarned;
}

/**
 * PUT /api/bookings/:id/status
 * Update status and/or paymentStatus of a booking (Admin only)
 */
export const updateBookingStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, paymentStatus, paymentMode, customerId } = req.body;

    const existing = await prisma.booking.findUnique({
      where: { id: String(id) },
      include: { customer: true },
    });

    if (!existing) {
      throw new AppError('Booking not found', 404);
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (paymentMode) updateData.paymentMode = paymentMode;

    if (customerId && typeof customerId === 'string' && customerId.trim()) {
      const targetCustomer = await prisma.customer.findUnique({
        where: { id: customerId.trim() },
      });
      if (!targetCustomer) {
        throw new AppError('Customer not found with provided customerId', 404);
      }
      updateData.customerId = targetCustomer.id;
    }

    const targetStatus = status || existing.status;
    if (
      existing.status === BookingStatus.DUMMY_BOOKING &&
      (targetStatus === BookingStatus.CONFIRMED || targetStatus === BookingStatus.COMPLETED)
    ) {
      if (!updateData.customerId && !existing.customerId) {
        throw new AppError('Customer details are required to confirm this dummy booking.', 400);
      }
    }

    const updatedBooking = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
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

      const pointsEarned = await grantBookingRewardsIfEligible(booking, tx);
      return { ...booking, pointsEarned };
    });

    if (
      (updatedBooking.status === 'CONFIRMED' || updatedBooking.status === 'COMPLETED') &&
      updatedBooking.paymentStatus === 'SUCCESS' &&
      updatedBooking.customerId &&
      !isMembershipOnlyBooking(updatedBooking)
    ) {
      try {
        await generateOrGetInvoiceForBooking(updatedBooking.id);
      } catch (invErr) {
        console.error('Failed to auto-generate invoice on status update:', invErr);
      }
    }

    if (
      existing.status === BookingStatus.DUMMY_BOOKING &&
      (updatedBooking.status === 'CONFIRMED' || updatedBooking.status === 'COMPLETED') &&
      updatedBooking.customer?.phone
    ) {
      try {
        const smsResult = await sendBookingDetailsSms(updatedBooking.customer.phone, updatedBooking.bookingNumber);
        if (!smsResult.success) {
          console.warn('[BOOKING STATUS UPDATE SMS FAILED]', smsResult.message || smsResult.error);
        }
      } catch (smsErr) {
        console.error('Failed to send booking SMS on status update:', smsErr);
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
    const isDummy = req.body.status === BookingStatus.DUMMY_BOOKING;

    // Express-validator validation (customerId is optional if DUMMY_BOOKING)
    if (!isDummy) {
      await body('customerId')
        .notEmpty().withMessage('Customer ID is required')
        .isString().withMessage('Customer ID must be a string')
        .trim()
        .run(req);
    }
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

    // Look up customer — must already exist unless dummy booking
    let targetCustomerId: string | null = null;
    let existingCustomer: any = null;
    const rawCustomerId = typeof customerId === 'string' ? customerId.trim() : '';
    if (rawCustomerId) {
      existingCustomer = await prisma.customer.findUnique({
        where: { id: rawCustomerId },
      });
      if (existingCustomer) {
        targetCustomerId = existingCustomer.id;
      } else if (!isDummy) {
        throw new AppError('Customer not found with the provided customerId', 404);
      }
    } else if (!isDummy) {
      throw new AppError('Customer ID is required', 400);
    }

    // Validate Items
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('Booking must contain at least one item (service or package)', 400);
    }

    // Process, validate & calculate prices for items
    let subtotal = 0;
    interface AdminProcessedItem {
      serviceId: string | null;
      packageId: string | null;
      staffId: string | null;
      date: string;
      timeSlot: string;
      duration: number;
      price: number;
    }
    const processedItems: AdminProcessedItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object') {
        throw new AppError(`Item #${i + 1} is invalid`, 400);
      }

      const hasService = Boolean(item.serviceId && typeof item.serviceId === 'string' && item.serviceId.trim());
      const hasPackage = Boolean(item.packageId && typeof item.packageId === 'string' && item.packageId.trim());

      if (!hasService && !hasPackage) {
        if (!isDummy) {
          throw new AppError(`Item #${i + 1} must specify either a valid serviceId or packageId`, 400);
        }
      }

      if (hasService && hasPackage) {
        throw new AppError(`Item #${i + 1} cannot specify both serviceId and packageId`, 400);
      }

      if (isDummy && (!item.staffId || typeof item.staffId !== 'string' || !item.staffId.trim())) {
        throw new AppError(`Stylist is required for dummy booking item #${i + 1}`, 400);
      }

      let price = (item.price !== undefined && item.price !== null && !isNaN(Number(item.price)))
        ? Number(item.price)
        : 0;

      if (isDummy) {
        price = 0;
      } else if (price < 0) {
        throw new AppError(`Price for item #${i + 1} must be a valid non-negative number`, 400);
      }

      let cleanServiceId: string | null = null;
      let cleanPackageId: string | null = null;

      let itemDuration = 30;

      if (hasService) {
        const serviceIdToLookup = item.serviceId.trim();
        const srv = await prisma.service.findUnique({ where: { id: serviceIdToLookup } });
        if (!srv) {
          throw new AppError(`Service not found for item #${i + 1}`, 404);
        }
        const roles = (req.user?.roles || []).map((r: any) => r.role);
        const isAdmin = roles.includes(Role.ADMIN) || roles.includes(Role.SUPER_ADMIN);
        if (!srv.isActive && !isAdmin) {
          throw new AppError(`Service '${srv.name}' is currently unavailable`, 400);
        }
        if (srv.saloonId !== targetSaloonId) {
          throw new AppError(`Service '${srv.name}' does not belong to the selected saloon`, 400);
        }
        cleanServiceId = serviceIdToLookup;
        if (price === 0) {
          const menuPrice = (srv.discountPrice > 0 && srv.discountPrice < srv.price)
            ? Number(srv.discountPrice)
            : (Number(srv.price) || 0);
          const tax = Math.round(menuPrice * 0.05 * 100) / 100;
          price = Math.round(menuPrice + tax);
        }
        if (typeof srv.duration === 'number' && srv.duration > 0) {
          itemDuration = srv.duration;
        }
      } else if (hasPackage) {
        const packageIdToLookup = item.packageId.trim();
        const pkg = await prisma.package.findUnique({
          where: { id: packageIdToLookup },
          include: { services: true },
        });
        if (!pkg) {
          throw new AppError(`Package not found for item #${i + 1}`, 404);
        }
        if (pkg.saloonId !== targetSaloonId) {
          throw new AppError(`Package '${pkg.name}' does not belong to the selected saloon`, 400);
        }
        cleanPackageId = packageIdToLookup;
        if (price === 0) {
          const menuPrice = (pkg.discountPrice > 0 && pkg.discountPrice < pkg.price)
            ? Number(pkg.discountPrice)
            : (Number(pkg.price) || 0);
          const tax = Math.round(menuPrice * 0.05 * 100) / 100;
          price = Math.round(menuPrice + tax);
        }
        const totalPkgDuration = pkg.services?.reduce((sum, s) => sum + (s.duration || 0), 0) || 0;
        if (totalPkgDuration > 0) {
          itemDuration = totalPkgDuration;
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

      const rawSlot = (item.timeSlot && typeof item.timeSlot === 'string') ? item.timeSlot.trim() : '';
      const isCompleted = status === BookingStatus.COMPLETED;

      if (cleanStaffId && rawSlot && !isCompleted) {
        // Intra-booking conflict check taking durations into account
        const conflict = processedItems.find(
          (p) =>
            p.staffId === cleanStaffId &&
            extractDateMatchKey(p.date) === extractDateMatchKey(formattedDate) &&
            doSlotRangesOverlap(p.timeSlot, p.duration, rawSlot, itemDuration)
        );
        if (conflict) {
          throw new AppError(
            `Stylist is already assigned to another service during this time window (${rawSlot}) on this date. Please choose a different stylist or time slot.`,
            400
          );
        }

        // Validate against stylist schedule and existing bookings
        const slotAvailability = await isStaffSlotAvailable(cleanStaffId, formattedDate, rawSlot, itemDuration);
        if (!slotAvailability.available) {
          throw new AppError(slotAvailability.reason || `Time slot "${rawSlot}" is not available`, 400);
        }
      }

      subtotal += price;
      processedItems.push({
        serviceId: cleanServiceId,
        packageId: cleanPackageId,
        staffId: cleanStaffId,
        date: formattedDate,
        timeSlot: rawSlot,
        duration: itemDuration,
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
    const effectivePaymentStatus = paymentMode === PaymentMode.MEMBERSHIP ? PaymentStatus.SUCCESS : paymentStatus;

    // Validate and Calculate membership deduction if requested or if paymentMode is MEMBERSHIP
    let actualMembershipUsed = 0;
    const requestedMemUsed =
      paymentMode === PaymentMode.MEMBERSHIP &&
        (membershipUsed === undefined || membershipUsed === null || Number(membershipUsed) === 0)
        ? balanceAfterDiscount
        : membershipUsed;

    if (requestedMemUsed !== undefined && requestedMemUsed !== null) {
      const numMemUsed = Number(requestedMemUsed);
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

    if (sanitizedCouponCode) {
      const couponOffer = await prisma.offer.findFirst({
        where: {
          couponCode: { equals: sanitizedCouponCode, mode: 'insensitive' },
          isActive: true,
        },
      });

      if (couponOffer && couponOffer.onlyForFirstService) {
        if (!targetCustomerId) {
          throw new AppError('This coupon is valid only for your first service.', 400);
        }
        const existingBookingCount = await prisma.booking.count({
          where: {
            customerId: targetCustomerId,
            status: { notIn: ['CANCELLED', 'DUMMY_BOOKING'] },
          },
        });
        if (existingBookingCount > 0) {
          throw new AppError('This coupon is valid only for your first service.', 400);
        }
      }
    }

    // Deduplication guard: check if an identical booking was created in the last 10 seconds
    const tenSecondsAgo = new Date(Date.now() - 10 * 1000);
    const staffSlotFilters = processedItems
      .filter((it) => it.staffId && it.timeSlot)
      .map((it) => ({
        staffId: it.staffId,
        date: it.date,
        timeSlot: it.timeSlot,
      }));

    if (staffSlotFilters.length > 0) {
      const existingRecentBooking = await prisma.booking.findFirst({
        where: {
          source: 'ADMIN',
          saloonId: targetSaloonId,
          customerId: targetCustomerId || null,
          createdAt: { gte: tenSecondsAgo },
          items: {
            some: {
              OR: staffSlotFilters,
            },
          },
        },
        include: {
          customer: true,
          saloon: true,
          items: {
            include: {
              service: true,
              package: { include: { services: true } },
              staff: true,
            },
          },
        },
      });

      if (existingRecentBooking) {
        res.json(new AppResponse('Booking already created (duplicate request prevented)', existingRecentBooking, 200));
        return;
      }
    }

    const newBooking = await prisma.$transaction(async (tx) => {
      // Serialize concurrent booking attempts per stylist and date to eliminate race conditions
      if (status !== BookingStatus.COMPLETED) {
        for (const item of processedItems) {
          if (item.staffId && item.timeSlot) {
            const dateKey = extractDateMatchKey(item.date);
            const lockKey = `staff_booking_${item.staffId}_${dateKey}`;
            // Transaction-level advisory lock serializes access to this staff + date
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

            // Re-verify availability inside the transaction
            const slotCheck = await isStaffSlotAvailable(
              item.staffId,
              item.date,
              item.timeSlot,
              item.duration,
              undefined,
              tx
            );

            if (!slotCheck.available) {
              throw new AppError(
                slotCheck.reason ||
                  `Time slot "${item.timeSlot}" is already booked. Please choose another time slot.`,
                400
              );
            }
          }
        }
      }

      const booking = await tx.booking.create({
        data: {
          bookingNumber,
          source: 'ADMIN',
          customerId: targetCustomerId,
          saloonId: targetSaloonId,
          status,
          paymentStatus: effectivePaymentStatus,
          paymentMode,
          subtotal,
          discount: numericDiscount,
          membershipUsed: actualMembershipUsed,
          totalAmount,
          couponCode: sanitizedCouponCode,
          items: {
            create: processedItems.map((item) => ({
              serviceId: item.serviceId,
              packageId: item.packageId,
              staffId: item.staffId,
              date: item.date,
              timeSlot: item.timeSlot,
              price: item.price,
            })),
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

      if (actualMembershipUsed > 0 && targetCustomerId) {
        await deductCustomerMembershipBalance(targetCustomerId, actualMembershipUsed, booking.id, tx);
      }

      const pointsEarned = await grantBookingRewardsIfEligible(booking, tx);

      return { ...booking, pointsEarned };
    });

    if (
      !isDummy &&
      (newBooking.status === 'CONFIRMED' || newBooking.status === 'COMPLETED') &&
      newBooking.paymentStatus === 'SUCCESS' &&
      newBooking.customerId &&
      !isMembershipOnlyBooking(newBooking)
    ) {
      try {
        await generateOrGetInvoiceForBooking(newBooking.id);
      } catch (invErr) {
        console.error('Failed to auto-generate invoice on admin booking create:', invErr);
      }
    }

    if (!isDummy) {
      const customerPhone = newBooking.customer?.phone || existingCustomer?.phone;
      if (customerPhone) {
        try {
          const smsResult = await sendBookingDetailsSms(customerPhone, newBooking.bookingNumber);
          if (!smsResult.success) {
            console.warn('[ADMIN BOOKING SMS FAILED]', smsResult.message || smsResult.error);
          }
        } catch (smsErr) {
          console.error('Failed to send booking SMS on admin booking create:', smsErr);
        }
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


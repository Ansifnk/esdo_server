import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { Role, ServiceGender, StaffType, StylistCategory } from '../../generated/prisma/enums';
import { getPagination, getPaginationMeta } from '../../utils/pagination';



export const createStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    await body('name').trim().notEmpty().withMessage('Name is required').run(req);
    await body('orderNo').optional().isInt({ min: 0 }).withMessage('Order number must be a non-negative integer').run(req);
    await body('phone').optional().isString().withMessage('Phone must be a string').run(req);
    await body('languages').optional().isArray().withMessage('languages must be an array').run(req);
    await body('saloonId').isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('categoryIds').optional().isArray().withMessage('categoryIds must be an array').run(req);
    await body('subCategoryIds').optional().isArray().withMessage('subCategoryIds must be an array').run(req);
    await body('slots').optional().isArray().withMessage('slots must be an array').run(req);
    await body('joiningDate').optional().isString().withMessage('joiningDate must be a string').run(req);
    await body('experience').optional({ nullable: true }).isNumeric().withMessage('experience must be a number').run(req);
    await body('happyClients').optional({ nullable: true }).isNumeric().withMessage('happyClients must be a number').run(req);
    await body('satisfaction').optional({ nullable: true }).isNumeric().withMessage('satisfaction must be a number').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);
    await body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').run(req);
    await body('serviceGender').optional({ nullable: true }).isIn([...Object.values(ServiceGender), null, '']).withMessage('Invalid serviceGender').run(req);
    await body('stylistCategory').optional({ nullable: true }).isIn([...Object.values(StylistCategory), null, '']).withMessage('Invalid stylistCategory').run(req);
    await body('type').optional().isIn(Object.values(StaffType)).withMessage('Invalid staff type').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    let {
      name,
      orderNo = 0,
      phone = '',
      languages = [],
      saloonId,
      categoryIds = [],
      subCategoryIds = [],
      slots = [],
      joiningDate = '',
      experience = null,
      happyClients = null,
      satisfaction = null,
      image = '',
      isActive = true,
      serviceGender = null,
      stylistCategory = null,
      type = StaffType.STYLIST,
    } = req.body;

    if (type !== StaffType.STYLIST) {
      categoryIds = [];
      subCategoryIds = [];
      serviceGender = null;
      stylistCategory = null;
      experience = null;
      happyClients = null;
      satisfaction = null;
    } else {
      serviceGender = serviceGender && Object.values(ServiceGender).includes(serviceGender) ? serviceGender : null;
      stylistCategory = stylistCategory && Object.values(StylistCategory).includes(stylistCategory) ? stylistCategory : null;
      experience = experience !== undefined && experience !== null && experience !== '' ? Number(experience) : 0;
      happyClients = happyClients !== undefined && happyClients !== null && happyClients !== '' ? Number(happyClients) : 0;
      satisfaction = satisfaction !== undefined && satisfaction !== null && satisfaction !== '' ? Number(satisfaction) : 0;
    }

    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if ((user as any).saloonId !== saloonId) {
          res.json(new AppResponse('Forbidden: You can only add staff to your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    // Verify Saloon exists
    const saloonExists = await prisma.saloon.findUnique({
      where: { id: saloonId },
    });
    if (!saloonExists) {
      res.json(new AppResponse('Saloon not found', {}, 404));
      return;
    }

    // Create staff in database
    const staff = await prisma.staff.create({
      data: {
        orderNo: orderNo !== undefined ? Number(orderNo) : 0,
        name,
        phone,
        languages,
        joiningDate,
        experience,
        happyClients,
        satisfaction,
        image,
        isActive,
        serviceGender,
        stylistCategory,
        type,
        saloon: { connect: { id: saloonId } },
        categories: {
          connect: categoryIds.map((id: string) => ({ id })),
        },
        subCategories: {
          connect: subCategoryIds.map((id: string) => ({ id })),
        },
        slots: {
          create: slots.map((s: any) => ({
            date: s.date,
            slots: s.slots || [],
            isWorking: s.isWorking ?? true,
          })),
        },
      },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        slots: true,
      },
    });

    res.json(new AppResponse('Staff member created successfully', staff, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getStaffs = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const saloonIdQuery = req.query.saloonId as string;
    const stylistCategoryQuery = req.query.stylistCategory as StylistCategory;
    const saloonIdsRaw = req.query.saloonIds || req.query['saloonIds[]'];
    let saloonIds: string[] = [];

    if (saloonIdsRaw) {
      if (Array.isArray(saloonIdsRaw)) {
        saloonIds = saloonIdsRaw.map((id) => String(id).trim()).filter((id) => id.length > 0);
      } else if (typeof saloonIdsRaw === 'string') {
        saloonIds = saloonIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
      }
    }

    const where: any = {};

    const user = req.user;
    if (user) {
      const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
      const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

      if (!isSuperAdmin && isAdmin) {
        where.saloonId = (user as any).saloonId;
      } else if (saloonIds.length > 0) {
        where.saloonId = { in: saloonIds };
      } else if (saloonIdQuery) {
        where.saloonId = saloonIdQuery;
      }
    } else if (saloonIds.length > 0) {
      where.saloonId = { in: saloonIds };
    } else if (saloonIdQuery) {
      where.saloonId = saloonIdQuery;
    }

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const typeQuery = req.query.type as StaffType;
    const serviceGenderQuery = req.query.serviceGender as ServiceGender;
    const serviceIdQuery = req.query.serviceId as string;

    if (serviceIdQuery) {
      where.services = { some: { id: serviceIdQuery } };
    }

    if (stylistCategoryQuery && Object.values(StylistCategory).includes(stylistCategoryQuery)) {
      where.stylistCategory = stylistCategoryQuery;
    }

    if (typeQuery && Object.values(StaffType).includes(typeQuery)) {
      where.type = typeQuery;
    }

    if (serviceGenderQuery && Object.values(ServiceGender).includes(serviceGenderQuery)) {
      where.serviceGender = { in: [serviceGenderQuery, ServiceGender.UNI] };
    }

    const pagination = getPagination(req);
    const [staffs, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        include: {
          saloon: true,
          categories: true,
          subCategories: true,
          slots: true,
          reviews: {
            select: {
              rating: true,
            },
          },
        },
        skip: pagination.offset,
        take: pagination.limit,
        orderBy: [{ orderNo: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.staff.count({ where }),
    ]);

    const formattedStaffs = staffs.map((s: any) => {
      const avg = s.avgRating;
      const count = s.ratingCount;
      return {
        ...s,
        avgRating: avg,
        ratingCount: count,
        rating: avg,
        reviewsCount: count,
        satisfactionRate: s.satisfaction !== null && s.satisfaction !== undefined ? `${s.satisfaction}%` : null,
      };
    });

    const meta = getPaginationMeta(total, pagination);
    res.json(new AppResponse('Staff members retrieved successfully', formattedStaffs, 200, meta));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const getStaffById = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid staff ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const user = req.user;

    const staff = await prisma.staff.findUnique({
      where: { id },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        slots: true,
        reviews: {
          select: {
            rating: true,
          },
        },
      },
    });

    if (!staff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    if (user) {
      const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
      const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

      if (!isSuperAdmin && isAdmin && staff.saloonId !== (user as any).saloonId) {
        res.json(new AppResponse('Forbidden: Access denied to this staff member', {}, 403));
        return;
      }
    }

    const avg = staff.avgRating;
    const count = staff.ratingCount;
    const formattedStaff = {
      ...staff,
      avgRating: avg,
      ratingCount: count,
      rating: avg,
      reviewsCount: count,
      satisfactionRate: staff.satisfaction !== null && staff.satisfaction !== undefined ? `${staff.satisfaction}%` : null,
    };

    res.json(new AppResponse('Staff member retrieved successfully', formattedStaff, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const updateStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid staff ID format').run(req);
    await body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').run(req);
    await body('orderNo').optional().isInt({ min: 0 }).withMessage('Order number must be a non-negative integer').run(req);
    await body('phone').optional().isString().withMessage('Phone must be a string').run(req);
    await body('languages').optional().isArray().withMessage('languages must be an array').run(req);
    await body('saloonId').optional().isUUID().withMessage('Invalid saloon ID format').run(req);
    await body('categoryIds').optional().isArray().withMessage('categoryIds must be an array').run(req);
    await body('subCategoryIds').optional().isArray().withMessage('subCategoryIds must be an array').run(req);
    await body('slots').optional().isArray().withMessage('slots must be an array').run(req);
    await body('joiningDate').optional().isString().withMessage('joiningDate must be a string').run(req);
    await body('experience').optional({ nullable: true }).isNumeric().withMessage('experience must be a number').run(req);
    await body('happyClients').optional({ nullable: true }).isNumeric().withMessage('happyClients must be a number').run(req);
    await body('satisfaction').optional({ nullable: true }).isNumeric().withMessage('satisfaction must be a number').run(req);
    await body('image').optional().isString().withMessage('Image must be a string').run(req);
    await body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').run(req);
    await body('serviceGender').optional({ nullable: true }).isIn([...Object.values(ServiceGender), null, '']).withMessage('Invalid serviceGender').run(req);
    await body('stylistCategory').optional({ nullable: true }).isIn([...Object.values(StylistCategory), null, '']).withMessage('Invalid stylistCategory').run(req);
    await body('type').optional().isIn(Object.values(StaffType)).withMessage('Invalid staff type').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    let { name, orderNo, phone, languages, saloonId, categoryIds, subCategoryIds, slots, joiningDate, experience, happyClients, satisfaction, image, isActive, serviceGender, stylistCategory, type } = req.body;

    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingStaff = await prisma.staff.findUnique({
      where: { id },
    });
    if (!existingStaff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingStaff.saloonId !== (user as any).saloonId || (saloonId && saloonId !== (user as any).saloonId)) {
          res.json(new AppResponse('Forbidden: You can only update staff belonging to your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    if (saloonId) {
      const saloonExists = await prisma.saloon.findUnique({
        where: { id: saloonId },
      });
      if (!saloonExists) {
        res.json(new AppResponse('Saloon not found', {}, 404));
        return;
      }
    }

    const targetType = type ?? existingStaff.type;
    const isStylist = targetType === StaffType.STYLIST;

    if (!isStylist) {
      categoryIds = [];
      subCategoryIds = [];
      serviceGender = null;
      stylistCategory = null;
      experience = null;
      happyClients = null;
      satisfaction = null;
    } else {
      if (serviceGender !== undefined) {
        serviceGender = serviceGender && Object.values(ServiceGender).includes(serviceGender) ? serviceGender : null;
      }
      if (stylistCategory !== undefined) {
        stylistCategory = stylistCategory && Object.values(StylistCategory).includes(stylistCategory) ? stylistCategory : null;
      }
      if (experience !== undefined && experience !== null && experience !== '') {
        experience = Number(experience);
      }
      if (happyClients !== undefined && happyClients !== null && happyClients !== '') {
        happyClients = Number(happyClients);
      }
      if (satisfaction !== undefined && satisfaction !== null && satisfaction !== '') {
        satisfaction = Number(satisfaction);
      }
    }

    // Execute update in transaction
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id },
        data: {
          orderNo: orderNo !== undefined ? Number(orderNo) : existingStaff.orderNo,
          name: name ?? existingStaff.name,
          phone: phone ?? existingStaff.phone,
          languages: languages ?? existingStaff.languages,
          joiningDate: joiningDate ?? existingStaff.joiningDate,
          experience: isStylist
            ? (experience !== undefined ? (experience !== null && experience !== '' ? Number(experience) : 0) : existingStaff.experience)
            : null,
          happyClients: isStylist
            ? (happyClients !== undefined ? (happyClients !== null && happyClients !== '' ? Number(happyClients) : 0) : existingStaff.happyClients)
            : null,
          satisfaction: isStylist
            ? (satisfaction !== undefined ? (satisfaction !== null && satisfaction !== '' ? Number(satisfaction) : 0) : existingStaff.satisfaction)
            : null,
          saloonId: saloonId ?? existingStaff.saloonId,
          image: image ?? existingStaff.image,
          isActive: isActive ?? existingStaff.isActive,
          serviceGender: isStylist
            ? (serviceGender !== undefined ? serviceGender : existingStaff.serviceGender)
            : null,
          stylistCategory: isStylist
            ? (stylistCategory !== undefined ? stylistCategory : existingStaff.stylistCategory)
            : null,
          type: type ?? existingStaff.type,
          categories: !isStylist
            ? { set: [] }
            : (categoryIds !== undefined ? { set: categoryIds.map((cid: string) => ({ id: cid })) } : undefined),
          subCategories: !isStylist
            ? { set: [] }
            : (subCategoryIds !== undefined ? { set: subCategoryIds.map((scid: string) => ({ id: scid })) } : undefined),
        },
      });

      if (slots !== undefined) {
        await tx.staffSlot.deleteMany({
          where: { staffId: id },
        });

        if (slots.length > 0) {
          await tx.staffSlot.createMany({
            data: slots.map((s: any) => ({
              staffId: id,
              date: s.date,
              slots: s.slots || [],
              isWorking: s.isWorking ?? true,
            })),
          });
        }
      }
    });

    const updatedStaff = await prisma.staff.findUnique({
      where: { id },
      include: {
        saloon: true,
        categories: true,
        subCategories: true,
        slots: true,
      },
    });

    if (!updatedStaff) {
      res.json(new AppResponse('Staff member not found after update', {}, 404));
      return;
    }

    res.json(new AppResponse('Staff member updated successfully', updatedStaff, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const deleteStaff = async (req: Request, res: Response): Promise<void> => {
  try {
    await param('id').isUUID().withMessage('Invalid staff ID format').run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json(new AppResponse(errors.array()[0].msg, {}, 400));
      return;
    }

    const id = req.params.id as string;
    const user = req.user;

    if (!user) {
      res.json(new AppResponse('Unauthorized', {}, 401));
      return;
    }

    const existingStaff = await prisma.staff.findUnique({
      where: { id },
    });
    if (!existingStaff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    const isSuperAdmin = user.roles.some((r: any) => r.role === Role.SUPER_ADMIN);
    const isAdmin = user.roles.some((r: any) => r.role === Role.ADMIN);

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (existingStaff.saloonId !== (user as any).saloonId) {
          res.json(new AppResponse('Forbidden: You can only delete staff from your own saloon', {}, 403));
          return;
        }
      } else {
        res.json(new AppResponse('Forbidden', {}, 403));
        return;
      }
    }

    await prisma.staff.delete({
      where: { id },
    });

    res.json(new AppResponse('Staff member deleted successfully', {}, 200));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

/**
 * Helper to extract ISO date key (YYYY-MM-DD) from an ISO date string for comparison.
 * Frontend always sends ISO dates (e.g. "2026-10-05T00:00:00.000Z").
 */
export function extractDateMatchKey(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}

/**
 * Standard list of time slots used across the system
 */
export const ALL_STANDARD_TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
  '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00',
  '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00',
  '19:30', '20:00', '20:30',
];

/**
 * Helper to normalize time slots to standard "HH:MM AM/PM" (e.g. "09:00", "9:00 AM", "13:00" -> "01:00 PM")
 */
export function normalizeTimeSlot(slotStr: string): string {
  if (!slotStr) return '';
  const trimmed = slotStr.trim().toUpperCase();
  // If 24-hr format "HH:MM"
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hStr, mStr] = trimmed.split(':');
    let h = parseInt(hStr, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${mStr} ${ampm}`;
  }
  const match = trimmed.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
  if (match) {
    const h = String(parseInt(match[1], 10)).padStart(2, '0');
    return `${h}:${match[2]} ${match[3]}`;
  }
  return trimmed;
}

/**
 * Standard duration of each time slot section in minutes (30 minutes)
 */
export const SECTION_DURATION_MINUTES = 30;

/**
 * Helper to parse a time slot string ("HH:MM" or "HH:MM AM/PM") into minutes from start of day (0-1439).
 */
export function timeSlotToMinutes(slotStr: string): number | null {
  if (!slotStr) return null;
  const trimmed = slotStr.trim().toUpperCase();

  // Try 24-hr format "HH:MM"
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hStr, mStr] = trimmed.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  // Try 12-hr format "HH:MM AM/PM" or "H:MM AM/PM"
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[3];
    if (isNaN(h) || isNaN(m)) return null;
    if (ampm === 'PM' && h !== 12) {
      h += 12;
    } else if (ampm === 'AM' && h === 12) {
      h = 0;
    }
    return h * 60 + m;
  }

  return null;
}

/**
 * Helper to convert minutes from midnight into normalized standard time slot "HH:MM AM/PM".
 */
export function minutesToTimeSlot(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Calculates number of 30-minute sections required for a given service duration in minutes.
 * E.g.:
 *   <= 30 mins -> 1 section (30 mins)
 *   45 mins    -> 2 sections (1 hr)
 *   60 mins    -> 2 sections (1 hr)
 *   75 mins    -> 3 sections (1.5 hrs)
 *   90 mins    -> 3 sections (1.5 hrs)
 */
export function getSectionsCountForDuration(durationMinutes?: number | null): number {
  if (!durationMinutes || typeof durationMinutes !== 'number' || durationMinutes <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(durationMinutes / SECTION_DURATION_MINUTES));
}

/**
 * Returns all normalized 30-minute time slots occupied by a service starting at startSlot
 * and lasting for durationMinutes.
 */
export function getTimeSlotsForDuration(startSlot: string, durationMinutes?: number | null): string[] {
  if (!startSlot) return [];
  const startMins = timeSlotToMinutes(startSlot);
  if (startMins === null) {
    const norm = normalizeTimeSlot(startSlot);
    return norm ? [norm] : [];
  }

  const sectionsCount = getSectionsCountForDuration(durationMinutes);
  const slots: string[] = [];
  for (let i = 0; i < sectionsCount; i++) {
    const slotMins = startMins + i * SECTION_DURATION_MINUTES;
    slots.push(minutesToTimeSlot(slotMins));
  }
  return slots;
}

/**
 * Helper to check whether two service time slot intervals overlap.
 */
export function doSlotRangesOverlap(
  startSlotA: string,
  durationA: number | null | undefined,
  startSlotB: string,
  durationB: number | null | undefined
): boolean {
  if (!startSlotA || !startSlotB) return false;
  const slotsA = getTimeSlotsForDuration(startSlotA, durationA);
  const slotsB = getTimeSlotsForDuration(startSlotB, durationB);
  const setA = new Set(slotsA);
  return slotsB.some((s) => setA.has(s));
}

/**
 * Helper to get the duration in minutes for an item (service or package).
 */
export function getItemDuration(item: {
  service?: { duration?: number | null } | null;
  package?: { services?: Array<{ duration?: number | null }> } | null;
  duration?: number | null;
}): number {
  if (typeof item.duration === 'number' && item.duration > 0) {
    return item.duration;
  }
  if (item.service && typeof item.service.duration === 'number' && item.service.duration > 0) {
    return item.service.duration;
  }
  if (item.package && Array.isArray(item.package.services)) {
    const total = item.package.services.reduce((acc, s) => acc + (s.duration || 0), 0);
    if (total > 0) return total;
  }
  return 30; // default 30 mins
}

/**
 * Helper to look up duration in minutes for a serviceId or packageId.
 */
export async function resolveServiceOrPackageDuration(
  serviceId?: string | null,
  packageId?: string | null
): Promise<number> {
  if (serviceId) {
    const s = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { duration: true },
    });
    if (s && typeof s.duration === 'number' && s.duration > 0) {
      return s.duration;
    }
  }
  if (packageId) {
    const p = await prisma.package.findUnique({
      where: { id: packageId },
      select: {
        services: {
          select: { duration: true },
        },
      },
    });
    if (p && Array.isArray(p.services)) {
      const total = p.services.reduce((acc, s) => acc + (s.duration || 0), 0);
      if (total > 0) return total;
    }
  }
  return 30;
}

/**
 * Checks whether a date or a time slot on today's date has already passed.
 */
export function isSlotInPast(dateStr?: string | null, timeSlotStr?: string | null): boolean {
  if (!dateStr) return false;

  const targetDateKey = extractDateMatchKey(dateStr);
  if (!targetDateKey) return false;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayKey = `${year}-${month}-${day}`;

  if (targetDateKey < todayKey) {
    return true; // Date is in the past
  }

  if (targetDateKey > todayKey) {
    return false; // Future date
  }

  // Same date (today): compare slot minutes
  if (!timeSlotStr) return false;

  const slotMinutes = timeSlotToMinutes(timeSlotStr);
  if (slotMinutes === null) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return slotMinutes <= currentMinutes;
}

/**
 * Helper to check whether a time slot (and its full service duration) is available for a given staff member on a specific date.
 * Validates against both staff working schedule (slots configured/removed in admin) and active confirmed bookings.
 * Note: Completed and cancelled bookings do not block slots.
 */
export async function isStaffSlotAvailable(
  staffId: string,
  dateStr: string,
  timeSlotStr: string,
  durationMinutes?: number | null,
  excludeBookingId?: string
): Promise<{ available: boolean; reason?: string }> {
  if (!staffId || !dateStr || !timeSlotStr) {
    return { available: true };
  }

  if (isSlotInPast(dateStr, timeSlotStr)) {
    return {
      available: false,
      reason: 'Cannot book a past date or time slot. Please choose an upcoming time slot.',
    };
  }

  const targetDateKey = extractDateMatchKey(dateStr);
  const requiredSlots = getTimeSlotsForDuration(timeSlotStr, durationMinutes);

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: { slots: true },
  });

  if (!staff) {
    return { available: false, reason: 'Staff member not found.' };
  }

  // 1. Check working schedule configured by admin
  if (targetDateKey && staff.slots) {
    const schedule = staff.slots.find((s) => extractDateMatchKey(s.date) === targetDateKey);
    if (schedule) {
      if (schedule.isWorking === false) {
        return {
          available: false,
          reason: `Stylist ${staff.name} is not available on this date. Please choose another date or stylist.`,
        };
      }
      if (Array.isArray(schedule.slots)) {
        const allowedNorm = schedule.slots.map(normalizeTimeSlot);
        if (allowedNorm.length === 0) {
          return {
            available: false,
            reason: `Stylist ${staff.name} has no available working slots on this date. Please choose another date or stylist.`,
          };
        }
        for (const reqSlot of requiredSlots) {
          if (!allowedNorm.includes(reqSlot)) {
            return {
              available: false,
              reason: `The time slot "${reqSlot}" is not available in ${staff.name}'s schedule. Please choose another slot.`,
            };
          }
        }
      }
    }
  }

  // 2. Check existing active confirmed bookings (COMPLETED and CANCELLED bookings do not block slots)
  const existingBookings = await prisma.bookingItem.findMany({
    where: {
      staffId,
      booking: {
        status: 'CONFIRMED',
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    },
    select: {
      date: true,
      timeSlot: true,
      service: {
        select: { duration: true },
      },
      package: {
        select: {
          services: {
            select: { duration: true },
          },
        },
      },
    },
  });

  const requiredSet = new Set(requiredSlots);

  for (const item of existingBookings) {
    if (extractDateMatchKey(item.date || '') === targetDateKey && item.timeSlot) {
      const bookedDuration = getItemDuration(item);
      const bookedSlots = getTimeSlotsForDuration(item.timeSlot, bookedDuration);
      for (const bSlot of bookedSlots) {
        if (requiredSet.has(bSlot)) {
          return {
            available: false,
            reason: `The time slot "${bSlot}" is already booked for ${staff.name}. Please choose another time slot.`,
          };
        }
      }
    }
  }

  return { available: true };
}

/**
 * GET /api/staffs/:id/booked-slots?date=...&serviceId=...&packageId=...&duration=...
 * Returns unavailable / already booked slots for a specific stylist on a date.
 * If schedule exists for that date, any slot removed from the schedule by the admin is returned in blockedSlots.
 * If a service is booked, blocks the time according to that service time (in 30-min sections).
 * If duration or serviceId/packageId is provided, also marks candidate slots that cannot accommodate the duration.
 */
export const getStaffBookedSlots = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { date, serviceId, packageId, duration } = req.query;

    const staff = await prisma.staff.findUnique({
      where: { id },
      include: {
        slots: true,
      },
    });

    if (!staff) {
      res.json(new AppResponse('Staff member not found', {}, 404));
      return;
    }

    // Find all active confirmed booking items for this staff member (COMPLETED and CANCELLED slots are available)
    const bookingItems = await prisma.bookingItem.findMany({
      where: {
        staffId: id,
        booking: {
          status: 'CONFIRMED',
        },
      },
      select: {
        id: true,
        date: true,
        timeSlot: true,
        service: {
          select: {
            duration: true,
          },
        },
        package: {
          select: {
            services: {
              select: {
                duration: true,
              },
            },
          },
        },
      },
    });

    const allBooked = bookingItems.map((b) => ({
      date: b.date || '',
      timeSlot: b.timeSlot || '',
      duration: getItemDuration(b),
      source: 'booking',
    }));

    const targetDateKey = date ? extractDateMatchKey(String(date)) : null;

    let isWorking = true;
    let scheduleFound = false;
    let allowedSlotsSet: Set<string> | null = null;

    if (targetDateKey && staff.slots) {
      const schedule = staff.slots.find((s) => extractDateMatchKey(s.date) === targetDateKey);
      if (schedule) {
        scheduleFound = true;
        if (schedule.isWorking === false) {
          isWorking = false;
        } else if (Array.isArray(schedule.slots)) {
          allowedSlotsSet = new Set(schedule.slots.map(normalizeTimeSlot));
          if (allowedSlotsSet.size === 0) {
            isWorking = false;
          }
        }
      }
    }

    const blockedSlotsForDate: string[] = [];
    if (!isWorking) {
      blockedSlotsForDate.push('ALL');
    } else {
      // 1. If schedule was configured by admin for this date, block any slots removed from schedule.slots
      if (scheduleFound && allowedSlotsSet) {
        for (const slot of ALL_STANDARD_TIME_SLOTS) {
          const norm = normalizeTimeSlot(slot);
          if (norm && !allowedSlotsSet.has(norm) && !blockedSlotsForDate.includes(norm)) {
            blockedSlotsForDate.push(norm);
          }
        }
      }

      // 2. Block already booked slots according to each service duration (in 30 min sections)
      for (const item of allBooked) {
        if (!targetDateKey || extractDateMatchKey(item.date) === targetDateKey) {
          if (item.timeSlot) {
            const bookedSlots = getTimeSlotsForDuration(item.timeSlot, item.duration);
            for (const bSlot of bookedSlots) {
              const norm = normalizeTimeSlot(bSlot);
              if (norm && !blockedSlotsForDate.includes(norm)) {
                blockedSlotsForDate.push(norm);
              }
            }
          }
        }
      }

      // 3. Block any time slots that have already passed
      if (targetDateKey) {
        for (const slot of ALL_STANDARD_TIME_SLOTS) {
          if (isSlotInPast(date ? String(date) : '', slot)) {
            const norm = normalizeTimeSlot(slot);
            if (norm && !blockedSlotsForDate.includes(norm)) {
              blockedSlotsForDate.push(norm);
            }
          }
        }
      }

      // 4. If duration or serviceId/packageId is provided, also block candidate slots that cannot fit the service duration
      let requestedDuration = duration ? Number(duration) : 0;
      if (!requestedDuration && (serviceId || packageId)) {
        requestedDuration = await resolveServiceOrPackageDuration(
          serviceId ? String(serviceId) : null,
          packageId ? String(packageId) : null
        );
      }

      if (requestedDuration > 30) {
        const standardSlotsNorm = ALL_STANDARD_TIME_SLOTS.map(normalizeTimeSlot);
        for (const slot of ALL_STANDARD_TIME_SLOTS) {
          const norm = normalizeTimeSlot(slot);
          if (!blockedSlotsForDate.includes(norm)) {
            const candidateSlots = getTimeSlotsForDuration(slot, requestedDuration);
            const cannotFit = candidateSlots.some((reqSlot) => {
              if (blockedSlotsForDate.includes(reqSlot)) return true;
              if (scheduleFound && allowedSlotsSet && !allowedSlotsSet.has(reqSlot)) return true;
              if (!standardSlotsNorm.includes(reqSlot)) return true;
              return false;
            });
            if (cannotFit) {
              blockedSlotsForDate.push(norm);
            }
          }
        }
      }
    }

    res.json(
      new AppResponse('Booked slots retrieved successfully', {
        staffId: id,
        staffName: staff.name,
        date: date || null,
        isWorking,
        blockedSlots: blockedSlotsForDate,
      }, 200)
    );
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

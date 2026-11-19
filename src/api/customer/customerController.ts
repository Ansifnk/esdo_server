import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';
import { getPagination, getPaginationMeta } from '../../utils/pagination';
import { Gender } from '../../generated/prisma/enums';
import { normalizePhone, getPhoneLookupVariants, findCustomerByPhone } from '../../utils/phoneUtils';

/**
 * GET /api/customer
 * Search / List customers for Admin
 */
export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search = '' } = req.query;
    const paginationParams = getPagination(req, 20);

    const whereCondition: any = {};
    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim();
      const qDigits = q.replace(/\D/g, '');
      whereCondition.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        ...(qDigits.length >= 3 ? [{ phone: { contains: qDigits } }] : []),
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rawCustomers, total] = await Promise.all([
      prisma.customer.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' },
        skip: paginationParams.offset,
        take: paginationParams.limit,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          gender: true,
          birthDate: true,
          address: true,
          points: true,
          referralCode: true,
          defaultSaloonId: true,
          defaultSaloon: true,
          rewardTransactions: {
            where: {
              status: 'ACTIVE',
              remainingCoins: { gt: 0 },
            },
            select: {
              type: true,
              remainingCoins: true,
            },
          },
          createdAt: true,
        },
      }),
      prisma.customer.count({ where: whereCondition }),
    ]);

    const customers = rawCustomers.map((c) => {
      let rewardPoints = 0;
      let referralPoints = 0;
      for (const tx of c.rewardTransactions || []) {
        if (tx.type === 'SPEND_EARN') rewardPoints += tx.remainingCoins;
        else if (tx.type === 'REFERRAL_EARN') referralPoints += tx.remainingCoins;
      }
      const totalPoints = c.points || 0;
      if (rewardPoints + referralPoints < totalPoints) {
        rewardPoints += (totalPoints - (rewardPoints + referralPoints));
      }

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        gender: c.gender,
        birthDate: c.birthDate,
        address: c.address || '',
        points: totalPoints,
        rewardPoints,
        referralPoints,
        referralCode: c.referralCode,
        defaultSaloonId: c.defaultSaloonId,
        defaultSaloon: c.defaultSaloon,
        saloonId: c.defaultSaloonId,
        saloon: c.defaultSaloon,
        createdAt: c.createdAt,
      };
    });

    const paginationMeta = getPaginationMeta(total, paginationParams);

    res.json(new AppResponse('Customers retrieved successfully', customers, 200, paginationMeta));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve customers', {}, statusCode));
  }
};

/**
 * POST /api/customer
 * Create a new customer (Admin)
 */
export const createCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, phone, email, birthDate, address, gender } = req.body;

    const normalizedGender = gender ? String(gender).toUpperCase().trim() : null;
    if (!normalizedGender || !Object.values(Gender).includes(normalizedGender as Gender)) {
      throw new AppError('Gender is required', 400);
    }

    const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
    let parsedBirthDate: Date | null = null;
    if (birthDate) {
      const d = new Date(birthDate);
      if (!isNaN(d.getTime())) {
        parsedBirthDate = d;
      }
    }
    const cleanAddress = address && typeof address === 'string' && address.trim() !== '' ? address.trim() : null;

    if (!name && !phone && !cleanEmail) {
      throw new AppError('Please provide at least a customer name, phone number, or email.', 400);
    }

    const normalizedPhone = phone && typeof phone === 'string' && phone.trim() !== '' ? normalizePhone(phone) : null;
    if (normalizedPhone) {
      const existing = await findCustomerByPhone(normalizedPhone);
      if (existing) {
        throw new AppError('A customer with this phone number already exists.', 400);
      }
    }

    if (cleanEmail) {
      const existing = await prisma.customer.findUnique({ where: { email: cleanEmail } });
      if (existing) {
        throw new AppError('A customer with this email address already exists.', 400);
      }
    }

    const targetSaloonId = req.body.defaultSaloonId || req.body.saloonId || null;
    if (targetSaloonId) {
      const saloon = await prisma.saloon.findUnique({ where: { id: targetSaloonId } });
      if (!saloon) {
        throw new AppError('Selected branch / saloon not found', 404);
      }
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name: name || 'Walk-in Customer',
        phone: normalizedPhone,
        email: cleanEmail,
        gender: normalizedGender as Gender,
        birthDate: parsedBirthDate,
        address: cleanAddress,
        defaultSaloonId: targetSaloonId,
      },
      include: {
        defaultSaloon: true,
      },
    });

    const { password: _, ...customerData } = newCustomer;

    res.status(201).json(new AppResponse('Customer created successfully', {
      ...customerData,
      saloonId: newCustomer.defaultSaloonId,
      saloon: newCustomer.defaultSaloon,
    }, 201));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to create customer', {}, statusCode));
  }
};

/**
 * GET /api/customer/:id
 * Retrieve customer details by ID (Admin)
 */
export const getCustomerById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const c = await prisma.customer.findUnique({
      where: { id: String(id) },
      include: {
        defaultSaloon: true,
        _count: {
          select: {
            bookings: true,
            memberships: true,
            reviews: true,
          },
        },
        rewardTransactions: {
          where: {
            status: 'ACTIVE',
            remainingCoins: { gt: 0 },
          },
          select: {
            type: true,
            remainingCoins: true,
          },
        },
      },
    });

    if (!c) {
      throw new AppError('Customer not found', 404);
    }

    let rewardPoints = 0;
    let referralPoints = 0;
    for (const tx of c.rewardTransactions || []) {
      if (tx.type === 'SPEND_EARN') rewardPoints += tx.remainingCoins;
      else if (tx.type === 'REFERRAL_EARN') referralPoints += tx.remainingCoins;
    }
    const totalPoints = c.points || 0;
    if (rewardPoints + referralPoints < totalPoints) {
      rewardPoints += (totalPoints - (rewardPoints + referralPoints));
    }

    const { password: _, ...cleanC } = c;

    const customerData = {
      ...cleanC,
      gender: c.gender,
      points: totalPoints,
      rewardPoints,
      referralPoints,
      saloonId: c.defaultSaloonId,
      saloon: c.defaultSaloon,
      address: c.address || '',
    };

    res.json(new AppResponse('Customer retrieved successfully', customerData, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to retrieve customer', {}, statusCode));
  }
};

/**
 * PUT /api/customer/:id or PATCH /api/customer/:id
 * Admin: Update customer details
 */
export const updateCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customer = await prisma.customer.findUnique({
      where: { id: String(id) },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const { name, phone, email, birthDate, address, defaultSaloonId, saloonId, gender } = req.body;
    const updateData: any = {};

    if (gender !== undefined) {
      const normalizedGender = gender ? String(gender).toUpperCase().trim() : null;
      if (!normalizedGender || !Object.values(Gender).includes(normalizedGender as Gender)) {
        throw new AppError('Valid gender is required', 400);
      }
      updateData.gender = normalizedGender as Gender;
    }

    if (name !== undefined) {
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName) {
        throw new AppError('Customer name cannot be empty', 400);
      }
      updateData.name = cleanName;
    }

    if (phone !== undefined) {
      const normalizedPhone = phone && typeof phone === 'string' && phone.trim() !== '' ? normalizePhone(phone) : null;
      if (normalizedPhone && normalizedPhone !== customer.phone) {
        const existing = await findCustomerByPhone(normalizedPhone);
        if (existing && existing.id !== customer.id) {
          throw new AppError('A customer with this phone number already exists.', 400);
        }
      }
      updateData.phone = normalizedPhone;
    }

    if (email !== undefined) {
      const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
      if (cleanEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new AppError('Please enter a valid email address', 400);
        }
        if (cleanEmail !== customer.email) {
          const existing = await prisma.customer.findUnique({ where: { email: cleanEmail } });
          if (existing && existing.id !== customer.id) {
            throw new AppError('A customer with this email already exists.', 400);
          }
        }
      }
      updateData.email = cleanEmail;
    }

    if (birthDate !== undefined) {
      if (!birthDate) {
        updateData.birthDate = null;
      } else {
        const d = new Date(birthDate);
        if (isNaN(d.getTime())) {
          throw new AppError('Please enter a valid birth date', 400);
        }
        if (d >= new Date()) {
          throw new AppError('Birth date must be in the past', 400);
        }
        updateData.birthDate = d;
      }
    }

    if (address !== undefined) {
      updateData.address = typeof address === 'string' ? address.trim() || null : null;
    }

    const targetSaloonId = defaultSaloonId !== undefined ? defaultSaloonId : saloonId;
    if (targetSaloonId !== undefined) {
      if (targetSaloonId && targetSaloonId.trim() !== '') {
        const saloon = await prisma.saloon.findUnique({ where: { id: targetSaloonId } });
        if (!saloon) {
          throw new AppError('Selected branch / saloon not found', 404);
        }
        updateData.defaultSaloonId = targetSaloonId;
      } else {
        updateData.defaultSaloonId = null;
      }
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: updateData,
      include: { defaultSaloon: true },
    });

    const { password: _, ...customerData } = updated;
    res.json(new AppResponse('Customer updated successfully', {
      ...customerData,
      saloonId: updated.defaultSaloonId,
      saloon: updated.defaultSaloon,
      address: updated.address || '',
    }, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to update customer', {}, statusCode));
  }
};

/**
 * DELETE /api/customer/:id
 * Admin: Delete customer
 */
export const deleteCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customer = await prisma.customer.findUnique({
      where: { id: String(id) },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    await prisma.customer.delete({
      where: { id: String(id) },
    });

    res.json(new AppResponse('Customer deleted successfully', {}, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to delete customer', {}, statusCode));
  }
};

/**
 * PATCH /api/customer/branch
 * Update logged-in customer's preferred branch / saloon
 */
export const updateCustomerBranch = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const targetSaloonId = req.body.defaultSaloonId || req.body.saloonId;
    if (!targetSaloonId) {
      throw new AppError('Branch (defaultSaloonId) is required', 400);
    }

    // Verify saloon exists
    const saloon = await prisma.saloon.findUnique({
      where: { id: targetSaloonId },
    });
    if (!saloon) {
      throw new AppError('Selected branch not found', 404);
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: { defaultSaloonId: targetSaloonId },
      include: { defaultSaloon: true },
    });

    const { password: _, ...customerData } = updatedCustomer;
    res.json(new AppResponse('Branch updated successfully', {
      ...customerData,
      saloonId: updatedCustomer.defaultSaloonId,
      saloon: updatedCustomer.defaultSaloon,
    }, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to update branch', {}, statusCode));
  }
};

/**
 * PATCH /api/customer/profile
 * Update logged-in customer's profile (name, email, birthDate, address)
 * Phone number cannot be edited here as per requirement.
 */
export const updateCustomerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const { name, email, birthDate, address, gender } = req.body;

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const updateData: any = {};

    if (gender !== undefined) {
      const normalizedGender = gender ? String(gender).toUpperCase().trim() : null;
      if (!normalizedGender || !Object.values(Gender).includes(normalizedGender as Gender)) {
        throw new AppError('Please select a valid gender', 400);
      }
      updateData.gender = normalizedGender as Gender;
    }

    if (name !== undefined) {
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName) {
        throw new AppError('Name cannot be empty', 400);
      }
      updateData.name = cleanName;
    }

    if (email !== undefined) {
      const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;
      if (cleanEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new AppError('Please enter a valid email address', 400);
        }
        if (cleanEmail !== customer.email) {
          const existing = await prisma.customer.findUnique({
            where: { email: cleanEmail },
          });
          if (existing && existing.id !== customerId) {
            throw new AppError('This email is already in use by another account', 400);
          }
        }
      }
      updateData.email = cleanEmail;
    }

    if (birthDate !== undefined) {
      if (!birthDate) {
        updateData.birthDate = null;
      } else {
        const d = new Date(birthDate);
        if (isNaN(d.getTime())) {
          throw new AppError('Please enter a valid birth date', 400);
        }
        if (d >= new Date()) {
          throw new AppError('Birth date must be in the past', 400);
        }
        updateData.birthDate = d;
      }
    }

    if (address !== undefined) {
      updateData.address = typeof address === 'string' ? address.trim() || null : null;
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
      include: { defaultSaloon: true },
    });

    const { password: _, ...customerData } = updatedCustomer;
    res.json(new AppResponse('Profile updated successfully', {
      ...customerData,
      saloonId: updatedCustomer.defaultSaloonId,
      saloon: updatedCustomer.defaultSaloon,
      address: updatedCustomer.address || '',
    }, 200));
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to update profile', {}, statusCode));
  }
};

/**
 * POST /api/customer/validate-import
 * Validate a batch of customer candidates before importing to DB
 * Checks for existing phone numbers and emails in the database
 */
export const validateImportCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phones = [], emails = [] } = req.body;

    const phoneVariantsToCheck: string[] = [];
    if (Array.isArray(phones)) {
      for (const p of phones) {
        if (typeof p === 'string' && p.trim()) {
          phoneVariantsToCheck.push(...getPhoneLookupVariants(p));
        }
      }
    }
    const cleanEmails = Array.isArray(emails)
      ? emails.filter((e: any) => typeof e === 'string' && e.trim()).map((e: string) => e.trim().toLowerCase())
      : [];

    const [existingPhones, existingEmails] = await Promise.all([
      phoneVariantsToCheck.length > 0
        ? prisma.customer.findMany({
          where: { phone: { in: phoneVariantsToCheck } },
          select: { phone: true, name: true, id: true },
        })
        : [],
      cleanEmails.length > 0
        ? prisma.customer.findMany({
          where: { email: { in: cleanEmails } },
          select: { email: true, name: true, id: true },
        })
        : [],
    ]);

    // Build set of existing normalized phones to flag any match in the imported batch
    const existingNormalizedPhones = new Set(
      existingPhones.map((p) => (p.phone ? normalizePhone(p.phone) : '')).filter(Boolean)
    );

    const flaggedExistingPhones = new Set<string>();
    // Include both original stored format and any input phones that match
    for (const p of existingPhones) {
      if (p.phone) flaggedExistingPhones.add(p.phone);
    }
    if (Array.isArray(phones)) {
      for (const p of phones) {
        if (typeof p === 'string' && existingNormalizedPhones.has(normalizePhone(p))) {
          flaggedExistingPhones.add(p);
        }
      }
    }

    res.json(
      new AppResponse('Validation completed', {
        existingPhones: Array.from(flaggedExistingPhones),
        existingEmails: existingEmails.map((e) => e.email).filter(Boolean),
        phoneMatches: existingPhones,
        emailMatches: existingEmails,
      }, 200)
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to validate customers', {}, statusCode));
  }
};

/**
 * POST /api/customer/bulk-import
 * Bulk import customers from parsed spreadsheet (Admin)
 */
export const bulkImportCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { customers = [] } = req.body;

    if (!Array.isArray(customers) || customers.length === 0) {
      throw new AppError('No customer records provided for import.', 400);
    }

    // Collect all phone lookup variants and emails to check against database
    const phoneVariantsToCheck: string[] = [];
    const allEmails: string[] = [];
    for (const c of customers) {
      if (c.phone && typeof c.phone === 'string' && c.phone.trim()) {
        phoneVariantsToCheck.push(...getPhoneLookupVariants(c.phone));
      }
      if (c.email && typeof c.email === 'string' && c.email.trim()) {
        allEmails.push(c.email.trim().toLowerCase());
      }
    }

    const [existingPhoneRecords, existingEmailRecords] = await Promise.all([
      phoneVariantsToCheck.length > 0
        ? prisma.customer.findMany({
          where: { phone: { in: phoneVariantsToCheck } },
          select: { phone: true },
        })
        : [],
      allEmails.length > 0
        ? prisma.customer.findMany({
          where: { email: { in: allEmails } },
          select: { email: true },
        })
        : [],
    ]);

    const existingNormalizedPhoneSet = new Set(
      existingPhoneRecords.map((r) => (r.phone ? normalizePhone(r.phone) : '')).filter(Boolean)
    );
    const existingEmailSet = new Set(existingEmailRecords.map((r) => r.email).filter(Boolean));

    const seenPhonesInBatch = new Set<string>();
    const seenEmailsInBatch = new Set<string>();

    const validInserts: any[] = [];
    const skippedRows: Array<{ rowNumber: number; reason: string; customer: any }> = [];

    customers.forEach((c: any, index: number) => {
      const rowNumber = index + 1;
      const rawName = c.name && typeof c.name === 'string' ? c.name.trim() : '';
      const rawPhone = c.phone ? String(c.phone).trim() : null;
      const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
      const rawEmail = c.email && typeof c.email === 'string' && c.email.trim() ? c.email.trim().toLowerCase() : null;

      // Must have at least name, phone, or email
      if (!rawName && !normalizedPhone && !rawEmail) {
        skippedRows.push({
          rowNumber,
          reason: 'Missing name, phone, and email. Row is completely empty.',
          customer: c,
        });
        return;
      }

      // Check phone duplication in DB (checks against both normalized and existing formats)
      if (normalizedPhone && existingNormalizedPhoneSet.has(normalizedPhone)) {
        skippedRows.push({
          rowNumber,
          reason: `Phone number '${rawPhone}' already exists in database.`,
          customer: c,
        });
        return;
      }

      // Check phone duplication within batch
      if (normalizedPhone && seenPhonesInBatch.has(normalizedPhone)) {
        skippedRows.push({
          rowNumber,
          reason: `Duplicate phone number '${rawPhone}' within the uploaded file.`,
          customer: c,
        });
        return;
      }

      // Check email duplication in DB
      if (rawEmail && existingEmailSet.has(rawEmail)) {
        skippedRows.push({
          rowNumber,
          reason: `Email address '${rawEmail}' already exists in database.`,
          customer: c,
        });
        return;
      }

      // Check email duplication within batch
      if (rawEmail && seenEmailsInBatch.has(rawEmail)) {
        skippedRows.push({
          rowNumber,
          reason: `Duplicate email '${rawEmail}' within the uploaded file.`,
          customer: c,
        });
        return;
      }

      // Parse birth date
      let parsedBirthDate: Date | null = null;
      if (c.birthDate) {
        const d = new Date(c.birthDate);
        if (!isNaN(d.getTime())) {
          parsedBirthDate = d;
        }
      }

      // Parse gender
      let parsedGender: Gender | null = null;
      if (c.gender) {
        const g = String(c.gender).toUpperCase().trim();
        if (['MALE', 'M', 'MEN', 'MAN'].includes(g)) parsedGender = Gender.MALE;
        else if (['FEMALE', 'F', 'WOMEN', 'WOMAN'].includes(g)) parsedGender = Gender.FEMALE;
        else if (['OTHER', 'O', 'NONBINARY'].includes(g)) parsedGender = Gender.OTHER;
        else if (Object.values(Gender).includes(g as Gender)) parsedGender = g as Gender;
      }

      // Track as seen
      if (normalizedPhone) {
        seenPhonesInBatch.add(normalizedPhone);
        existingNormalizedPhoneSet.add(normalizedPhone);
      }
      if (rawEmail) {
        seenEmailsInBatch.add(rawEmail);
        existingEmailSet.add(rawEmail);
      }

      validInserts.push({
        name: rawName || 'Walk-in Customer',
        phone: normalizedPhone,
        email: rawEmail,
        gender: parsedGender,
        birthDate: parsedBirthDate,
        address: c.address && typeof c.address === 'string' ? c.address.trim() || null : null,
      });
    });

    if (validInserts.length > 0) {
      await prisma.customer.createMany({
        data: validInserts,
        skipDuplicates: true,
      });
    }

    res.status(201).json(
      new AppResponse('Bulk import completed', {
        totalReceived: customers.length,
        importedCount: validInserts.length,
        skippedCount: skippedRows.length,
        skipped: skippedRows,
      }, 201)
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.status(statusCode).json(new AppResponse(error.message || 'Failed to bulk import customers', {}, statusCode));
  }
};


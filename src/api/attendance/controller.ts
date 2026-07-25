import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import { Role, AttendanceStatus } from '../../generated/prisma/enums';

// Get Attendance Records
export const getAttendanceRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = (req as any).user?.role;
    const userSaloonId = (req as any).user?.saloonId;

    const { date, startDate, endDate, staffId, status, search } = req.query;
    let saloonId = req.query.saloonId as string;

    if (userRole === Role.ADMIN) {
      if (!userSaloonId) {
        res.json(new AppResponse('Admin is not assigned to any saloon', {}, 403));
        return;
      }
      saloonId = userSaloonId;
    }

    const where: any = {};

    if (saloonId) {
      where.saloonId = saloonId;
    }

    if (staffId) {
      where.staffId = staffId as string;
    }

    if (status && Object.values(AttendanceStatus).includes(status as AttendanceStatus)) {
      where.status = status as AttendanceStatus;
    }

    if (date) {
      where.date = date as string;
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate as string;
      if (endDate) where.date.lte = endDate as string;
    }

    const attendanceRecords = await prisma.staffAttendance.findMany({
      where,
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            image: true,
            type: true,
            phone: true,
            saloonId: true,
            isActive: true,
          },
        },
        saloon: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { date: 'desc' },
        { staff: { name: 'asc' } },
      ],
    });

    // If fetching for a specific single saloon, also fetch all active staffs for that saloon
    // so frontend can show un-marked staff members.
    let allStaffs: any[] = [];
    if (saloonId) {
      const staffWhere: any = { saloonId, isActive: true };
      if (search) {
        staffWhere.name = { contains: search as string, mode: 'insensitive' };
      }
      allStaffs = await prisma.staff.findMany({
        where: staffWhere,
        select: {
          id: true,
          name: true,
          image: true,
          type: true,
          phone: true,
          saloonId: true,
        },
        orderBy: { name: 'asc' },
      });
    }

    res.json(
      new AppResponse('Attendance records retrieved successfully', {
        attendanceRecords,
        allStaffs,
      })
    );
  } catch (error: any) {
    console.error('Error fetching attendance records:', error);
    res.json(new AppResponse(error.message || 'Error fetching attendance records', {}, 500));
  }
};

// Mark or Update Single Staff Attendance
export const markAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = (req as any).user?.role;
    const userSaloonId = (req as any).user?.saloonId;

    const { staffId, saloonId: bodySaloonId, date, status, checkIn, checkOut, notes } = req.body;

    if (!staffId || !date || !status) {
      res.json(new AppResponse('staffId, date, and status are required fields', {}, 400));
      return;
    }

    // Verify staff exists and find saloonId
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, saloonId: true },
    });

    if (!staff) {
      res.json(new AppResponse('Staff not found', {}, 404));
      return;
    }

    const saloonId = staff.saloonId || bodySaloonId;

    if (userRole === Role.ADMIN && userSaloonId && userSaloonId !== saloonId) {
      res.json(new AppResponse('Unauthorized to mark attendance for staff in another saloon', {}, 403));
      return;
    }

    const record = await prisma.staffAttendance.upsert({
      where: {
        staffId_date: {
          staffId,
          date,
        },
      },
      update: {
        status: status as AttendanceStatus,
        checkIn: checkIn ?? '',
        checkOut: checkOut ?? '',
        notes: notes ?? '',
        saloonId,
      },
      create: {
        staffId,
        saloonId,
        date,
        status: status as AttendanceStatus,
        checkIn: checkIn ?? '',
        checkOut: checkOut ?? '',
        notes: notes ?? '',
      },
      include: {
        staff: {
          select: { id: true, name: true, image: true, type: true },
        },
      },
    });

    res.json(new AppResponse('Attendance marked successfully', { attendance: record }));
  } catch (error: any) {
    console.error('Error marking attendance:', error);
    res.json(new AppResponse(error.message || 'Error marking attendance', {}, 500));
  }
};

// Bulk Mark Attendance
export const bulkMarkAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = (req as any).user?.role;
    const userSaloonId = (req as any).user?.saloonId;

    const { date, saloonId: bodySaloonId, records } = req.body;

    if (!date || !Array.isArray(records) || records.length === 0) {
      res.json(new AppResponse('date and records array are required', {}, 400));
      return;
    }

    const saloonId = userRole === Role.ADMIN ? userSaloonId : bodySaloonId;

    const results = await prisma.$transaction(
      records.map((item: any) =>
        prisma.staffAttendance.upsert({
          where: {
            staffId_date: {
              staffId: item.staffId,
              date,
            },
          },
          update: {
            status: item.status as AttendanceStatus,
            checkIn: item.checkIn ?? '',
            checkOut: item.checkOut ?? '',
            notes: item.notes ?? '',
            saloonId: saloonId || item.saloonId,
          },
          create: {
            staffId: item.staffId,
            saloonId: saloonId || item.saloonId,
            date,
            status: item.status as AttendanceStatus,
            checkIn: item.checkIn ?? '',
            checkOut: item.checkOut ?? '',
            notes: item.notes ?? '',
          },
        })
      )
    );

    res.json(new AppResponse('Bulk attendance updated successfully', { updatedCount: results.length }));
  } catch (error: any) {
    console.error('Error bulk marking attendance:', error);
    res.json(new AppResponse(error.message || 'Error bulk marking attendance', {}, 500));
  }
};

// Get Monthly/Range Summary
export const getAttendanceSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = (req as any).user?.role;
    const userSaloonId = (req as any).user?.saloonId;

    const { month, staffId } = req.query;
    let saloonId = req.query.saloonId as string;

    if (userRole === Role.ADMIN) {
      saloonId = userSaloonId;
    }

    const where: any = {};

    if (saloonId) where.saloonId = saloonId;
    if (staffId) where.staffId = staffId as string;

    if (month) {
      // month expected format: YYYY-MM
      where.date = {
        startsWith: month as string,
      };
    }

    const records = await prisma.staffAttendance.findMany({
      where,
      select: {
        id: true,
        staffId: true,
        status: true,
        date: true,
      },
    });

    const summary = {
      total: records.length,
      present: records.filter((r) => r.status === AttendanceStatus.PRESENT).length,
      absent: records.filter((r) => r.status === AttendanceStatus.ABSENT).length,
      halfDay: records.filter((r) => r.status === AttendanceStatus.HALF_DAY).length,
      onLeave: records.filter((r) => r.status === AttendanceStatus.ON_LEAVE).length,
      late: records.filter((r) => r.status === AttendanceStatus.LATE).length,
    };

    res.json(new AppResponse('Attendance summary retrieved successfully', { summary }));
  } catch (error: any) {
    console.error('Error fetching attendance summary:', error);
    res.json(new AppResponse(error.message || 'Error fetching attendance summary', {}, 500));
  }
};

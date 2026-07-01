import { Request, Response, NextFunction } from 'express';
import AppError from '../models/AppError';
import { Role } from '../generated/prisma/enums';
import { User, UserRole, Customer } from '../generated/prisma/client';
import { verifyAccessToken } from '../api/auth/utils';
import { prisma } from '../lib/prisma';

declare global {
  namespace Express {
    interface Request {
      user?: (User & {
        roles: UserRole[];
      }) | (Customer & {
        roles: { role: Role }[];
      });
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('Authentication required', 401));
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (decoded.role === Role.CUSTOMER) {
      const customer = await prisma.customer.findUnique({
        where: { id: decoded.id },
      });
      if (!customer) {
        return next(new AppError('User not found', 401));
      }
      req.user = {
        ...customer,
        roles: [{ role: Role.CUSTOMER }],
      } as any;
    } else {
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: {
          roles: true,
        },
      });
      if (!user) {
        return next(new AppError('User not found', 401));
      }
      req.user = user;
    }

    next();
  } catch (error: any) {
    return next(new AppError('Invalid or expired token', 401));
  }
};

export const hasAuth = ({
  allRoles = [],
  anyRole = [],
}: {
  allRoles?: Role[];
  anyRole?: Role[];
} = {}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (allRoles.length > 0) {
      const userRoles = req.user.roles.map((role) => role.role);
      const hasAllRequiredRoles = allRoles.every((role) => userRoles.includes(role));
      if (!hasAllRequiredRoles) {
        return next(new AppError('Unauthorized', 403));
      }
    }

    if (anyRole.length > 0) {
      const userRoles = req.user.roles.map((role) => role.role);
      const hasRole = userRoles.some((role) => anyRole.includes(role));
      if (!hasRole) {
        return next(new AppError('Unauthorized', 403));
      }
    }

    next();
  };
};

import { Request, Response, NextFunction } from 'express';
import AppError from '../models/AppError';
import { Role } from '../generated/prisma/enums';
import { User, UserRole } from '../generated/prisma/client';
import { verifyAccessToken } from '../api/auth/utils';
import { prisma } from '../lib/prisma';

declare global {
  namespace Express {
    interface Request {
      user?: User & {
        roles: UserRole[];
      };
    }
  }
}

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

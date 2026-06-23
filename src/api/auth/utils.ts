import { Request, Response, CookieOptions } from 'express';
import { sign, verify } from 'jsonwebtoken';
import { Customer, Role } from '../../generated/prisma/client';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access_secret';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refresh_secret';
const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
const APP_ENV = process.env.NODE_ENV || 'development';

export interface RequestCustomer {
  id: string;
  email: string;
  name: string;
  sessionId: string;
  role: Role;
}

export function isCrossSiteFromLocalhost(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin.includes('localhost') || origin.includes('127.0.0.1');
}

export function getRefreshCookieOptions(req: Request): CookieOptions {
  const crossSite = isCrossSiteFromLocalhost(req);
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: APP_ENV !== 'development',
    path: APP_ENV !== 'development' ? '/api/auth/refresh-token' : '/',
  };
}

export const createAccessToken = (
  user: { id: string; email: string; name?: string | null },
  sessionId: string,
  role: Role
): string => {
  return sign(
    {
      id: user.id,
      email: user.email,
      name: user.name || '',
      sessionId,
      role,
    } as RequestCustomer,
    ACCESS_TOKEN_SECRET,
    {
      expiresIn: "24h",
    },
  );
};

export const createRefreshToken = (userId: string, sessionId: string,): string => {
  return sign({ userId, sessionId }, REFRESH_TOKEN_SECRET, {
    expiresIn: '7d',
  });
};

export const setRefreshTokenCookie = (res: Response, req: Request, value: string) => {
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  res.cookie(REFRESH_TOKEN_COOKIE_NAME, value, {
    ...getRefreshCookieOptions(req),
    expires,
  });
};

export const verifyAccessToken = (token: string): RequestCustomer => {
  return verify(token, ACCESS_TOKEN_SECRET) as RequestCustomer;
};

export const verifyRefreshToken = (
  token: string,
): { userId: string; sessionId: string } => {
  return verify(token, REFRESH_TOKEN_SECRET) as {
    userId: string;
    sessionId: string;
  };
};

export const getDeviceDetails = (req: Request): { device: string; ipAddress: string } => {
  const device = (req.headers['user-agent'] as string) || '';
  const ipAddress =
    ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '';

  return { device, ipAddress };
};

import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import {
  createAccessToken,
  createRefreshToken,
  setRefreshTokenCookie,
} from './utils';

export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;
    const source = (req.body.source as string) || 'web';

    if (!email || !password || !name) {
      res.json(new AppResponse('Email, password, and name are required', {}, 400));
      return;
    }

    // Check if customer already exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { email },
    });

    if (existingCustomer) {
      res.json(new AppResponse('Customer already exists', {}, 400));
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save to Customer table
    const customer = await prisma.customer.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    // Generate Session and Tokens
    const sessionId = crypto.randomUUID();
    const { password: _, ...customerWithoutPassword } = customer;
    
    const accessToken = createAccessToken(customerWithoutPassword, sessionId, source);
    const refreshToken = createRefreshToken(customer.id, sessionId, source);

    // Set Refresh Token in HTTP-only Cookie
    setRefreshTokenCookie(res, req, refreshToken);

    // Respond with access token
    res.json(new AppResponse('Registration successful', { customer: customerWithoutPassword, accessToken }, 201));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const source = (req.body.source as string) || 'web';

    if (!email || !password) {
      res.json(new AppResponse('Email and password are required', {}, 400));
      return;
    }

    // Retrieve customer
    const customer = await prisma.customer.findUnique({
      where: { email },
    });

    if (!customer) {
      res.json(new AppResponse('Invalid credentials', {}, 401));
      return;
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, customer.password);
    if (!isPasswordValid) {
      res.json(new AppResponse('Invalid credentials', {}, 401));
      return;
    }

    // Generate Session and Tokens
    const sessionId = crypto.randomUUID();
    const { password: _, ...customerWithoutPassword } = customer;

    const accessToken = createAccessToken(customerWithoutPassword, sessionId, source);
    const refreshToken = createRefreshToken(customer.id, sessionId, source);

    // Set Refresh Token in HTTP-only Cookie
    setRefreshTokenCookie(res, req, refreshToken);

    // Respond with access token
    res.json(new AppResponse('Login successful', { customer: customerWithoutPassword, accessToken }));
  } catch (error: any) {
    res.json(new AppResponse(error.message || 'Internal Server Error', {}, 500));
  }
};

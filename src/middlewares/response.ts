import { Request, Response, NextFunction } from 'express';
import AppResponse from '../models/AppResponse';

export const responseMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;

  res.json = function (body: any): Response {
    if (body instanceof AppResponse) {
      res.status(body.status);
      return originalJson.call(this, body.toJSON());
    }
    return originalJson.call(this, body);
  };

  next();
};

import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import AppResponse from '../models/AppResponse';

export default function validate(req: Request, res: Response, next: NextFunction): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.json(new AppResponse(errors.array()[0].msg, {}, 400));
    return false;
  }
  return true;
}

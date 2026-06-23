import { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  total: number;
  totalPages: number;
  currentPage: number;
  limit: number;
}

export function getPagination(req: Request, defaultLimit = 20): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit as string) || defaultLimit));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

export function getPaginationMeta(total: number, params: PaginationParams): PaginationMeta {
  return {
    total,
    totalPages: Math.ceil(total / params.limit),
    currentPage: params.page,
    limit: params.limit,
  };
}

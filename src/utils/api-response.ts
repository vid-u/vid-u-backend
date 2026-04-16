import type { Response } from "express";

/** Standard pagination metadata for list responses (top-level `meta` next to `data`). */
export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  current_page: number;
  items_per_page: number;
  total_items: number;
};

export function buildPaginationMeta(
  page: number,
  limit: number,
  totalItems: number,
): PaginationMeta {
  const total_pages =
    limit > 0 ? Math.max(0, Math.ceil(totalItems / limit)) : 0;
  return {
    page,
    current_page: page,
    limit,
    items_per_page: limit,
    total: totalItems,
    total_items: totalItems,
    total_pages,
  };
}

/** Prisma `skip` from 1-based page index. */
export function pageToOffset(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit);
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "ok",
  status = 200,
  meta?: PaginationMeta,
): void {
  res.status(status).json({
    success: true,
    message,
    data,
    ...(meta !== undefined ? { meta } : {}),
  });
}

export function sendError(
  res: Response,
  message: string,
  status: number,
  errors?: unknown
): void {
  res.status(status).json({
    success: false,
    message,
    ...(errors !== undefined ? { errors } : {}),
  });
}

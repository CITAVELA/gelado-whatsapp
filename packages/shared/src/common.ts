import { z } from 'zod';

export const uuid = z.string().uuid();
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Cursor para listas infinitas (bandeja, mensajes). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Forma de los errores de la API (siempre en español). */
export interface ApiError {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
}

/** Cabecera obligatoria en peticiones que cambian datos (CSRF, docs/04). */
export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'XMLHttpRequest';
export const SESSION_COOKIE = 'gelado_sid';

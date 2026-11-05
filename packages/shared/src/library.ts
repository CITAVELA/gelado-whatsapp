import { z } from 'zod';
import type { MediaDto } from './inbox';

export interface LibraryFolderDto { id: string; name: string; parentId: string | null; sortOrder: number; fileCount: number }
export interface LibraryFileDto { id: string; folderId: string | null; name: string; media: MediaDto; createdAt: string }

export const libraryFolderSchema = z.object({ name: z.string().trim().min(1).max(80), parentId: z.string().uuid().nullable().optional() });
export const libraryFileUpdateSchema = z.object({ name: z.string().trim().min(1).max(160).optional(), folderId: z.string().uuid().nullable().optional() });

/** Límites de tamaño de Meta por tipo (bytes) — comprobar en la documentación vigente. */
export const MEDIA_LIMITS = {
  image: { max: 5 * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] },
  sticker: { max: 500 * 1024, mimes: ['image/webp'] },
  audio: { max: 16 * 1024 * 1024, mimes: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'] },
  video: { max: 16 * 1024 * 1024, mimes: ['video/mp4', 'video/3gpp'] },
  document: {
    max: 100 * 1024 * 1024,
    mimes: [
      'application/pdf', 'text/plain', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  },
} as const;
export type WaMediaType = keyof typeof MEDIA_LIMITS;

/** Tipo de WhatsApp para un mime; null si no se puede enviar. Audio de navegador (webm) se convierte en el servidor. */
export function waMediaTypeFor(mime: string): WaMediaType | null {
  const m = mime.split(';')[0].trim().toLowerCase();
  for (const [t, def] of Object.entries(MEDIA_LIMITS) as [WaMediaType, (typeof MEDIA_LIMITS)[WaMediaType]][]) {
    if (t === 'sticker') continue;
    if ((def.mimes as readonly string[]).includes(m)) return t;
  }
  if (m === 'audio/webm' || m === 'audio/opus') return 'audio';
  return null;
}

export function validateMediaForWhatsApp(mime: string, size: number): { ok: true; type: WaMediaType } | { ok: false; reason: string } {
  const t = waMediaTypeFor(mime);
  if (!t) return { ok: false, reason: `Tipo de archivo no admitido por WhatsApp (${mime})` };
  const max = MEDIA_LIMITS[t].max;
  if (size > max) return { ok: false, reason: `El archivo supera el máximo de ${Math.round(max / 1024 / 1024)} MB para ${t}` };
  return { ok: true, type: t };
}

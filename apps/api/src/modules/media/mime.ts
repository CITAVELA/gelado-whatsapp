/** Utilidades de tipo MIME para los adjuntos. */

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** `audio/ogg; codecs=opus` → `audio/ogg` */
export function baseMime(mime: string): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

/** Extensión (sin punto) para guardar el archivo; usa el nombre original si el MIME no se conoce. */
export function extFor(mime: string, fileName?: string | null): string {
  const known = EXT_BY_MIME[baseMime(mime)];
  if (known) return known;
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? '');
  return m ? m[1]!.toLowerCase() : 'bin';
}

/** MIME que se aceptan de adjuntos entrantes: los que WhatsApp permite enviar (más el sticker). */
const INBOUND_MIME_ALLOWED = new Set([...Object.keys(EXT_BY_MIME), 'image/webp']);

/**
 * MIME de un adjunto entrante. Meta lo indica, pero un cliente puede mandar casi cualquier cosa: lo que no está en
 * la lista blanca se guarda como `application/octet-stream` (se sirve como descarga, nunca como HTML/SVG/JS).
 */
export function safeInboundMime(mime: string | null | undefined): string {
  const m = baseMime(mime ?? '');
  return INBOUND_MIME_ALLOWED.has(m) ? m : 'application/octet-stream';
}

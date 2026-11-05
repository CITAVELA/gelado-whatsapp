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

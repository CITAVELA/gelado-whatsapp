/**
 * Cabecera `Content-Disposition: attachment` válida para cualquier nombre (RFC 6266 / 5987):
 * `filename` con una versión solo ASCII (sin comillas, barras ni caracteres de control) y `filename*` con el
 * nombre original codificado en UTF-8. Un nombre no ASCII en `filename` hace que Node lance ERR_INVALID_CHAR.
 */
export function attachmentDisposition(filename: string): string {
  const clean = filename.replace(/[\r\n\0]/g, ' ').trim() || 'archivo';
  const ascii =
    clean
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\/;]/g, '_') || 'archivo';
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

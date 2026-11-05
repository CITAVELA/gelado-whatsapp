import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Errores siempre con forma { statusCode, message } y en español. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('HTTP');
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body && 'message' in body && typeof (body as any).message === 'string') {
        res.status(status).json({ statusCode: status, ...(body as object) });
        return;
      }
      const es: Record<number, string> = { 400: 'Petición no válida', 401: 'No autenticado', 403: 'No tienes permiso', 404: 'No encontrado', 409: 'Conflicto', 413: 'Archivo demasiado grande', 429: 'Demasiadas peticiones' };
      res.status(status).json({ statusCode: status, message: es[status] ?? 'Error', details: body });
      return;
    }
    // Errores de body-parser/multer (p. ej. cuerpo demasiado grande, JSON mal formado) traen su estado HTTP
    const st = (exception as any)?.status ?? (exception as any)?.statusCode;
    if (typeof st === 'number' && st >= 400 && st < 500) {
      const msg = st === 413 ? 'El contenido es demasiado grande' : st === 400 ? 'Petición no válida' : 'Petición rechazada';
      res.status(st).json({ statusCode: st, message: msg });
      return;
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Error interno del servidor' });
  }
}

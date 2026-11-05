import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Valida body/query con un esquema zod de @gelado/shared. Uso: @Body(new ZodPipe(schema)) */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      const first = r.error.issues[0];
      throw new BadRequestException({
        statusCode: 400,
        message: first ? `${first.path.join('.') || 'dato'}: ${first.message}` : 'Datos no válidos',
        code: 'VALIDATION',
        details: r.error.issues,
      });
    }
    return r.data;
  }
}

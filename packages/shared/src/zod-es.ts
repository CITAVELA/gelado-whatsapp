// Mensajes de validación de zod en español (F-2 de QA). Se activa al importar @gelado/shared (api y web).
import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

const TYPE_ES: Record<string, string> = {
  string: 'texto', number: 'número', boolean: 'sí/no', object: 'objeto', array: 'lista', date: 'fecha', undefined: 'vacío', null: 'vacío',
};

export const zodErrorMapEs: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Obligatorio' };
      return { message: `Se esperaba ${TYPE_ES[issue.expected] ?? issue.expected}` };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Correo no válido' };
      if (issue.validation === 'uuid') return { message: 'Identificador no válido' };
      if (issue.validation === 'url') return { message: 'Dirección web no válida' };
      if (issue.validation === 'datetime') return { message: 'Fecha y hora no válidas' };
      if (issue.validation === 'regex') return { message: 'Formato no válido' };
      return { message: 'Texto no válido' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'Obligatorio' : `Mínimo ${issue.minimum} caracteres` };
      if (issue.type === 'array') return { message: `Elige al menos ${issue.minimum}` };
      return { message: `Debe ser como mínimo ${issue.minimum}` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Máximo ${issue.maximum} caracteres` };
      if (issue.type === 'array') return { message: `Como máximo ${issue.maximum} elementos` };
      return { message: `Debe ser como máximo ${issue.maximum}` };
    case ZodIssueCode.invalid_enum_value:
      return { message: 'Valor no permitido' };
    case ZodIssueCode.invalid_union_discriminator:
    case ZodIssueCode.invalid_union:
      return { message: 'Tipo no válido' };
    case ZodIssueCode.invalid_literal:
      return { message: 'Valor no permitido' };
    case ZodIssueCode.unrecognized_keys:
      return { message: 'Campos no reconocidos' };
    case ZodIssueCode.invalid_date:
      return { message: 'Fecha no válida' };
    default:
      return { message: ctx.defaultError === 'Invalid input' ? 'Dato no válido' : ctx.defaultError };
  }
};

z.setErrorMap(zodErrorMapEs);

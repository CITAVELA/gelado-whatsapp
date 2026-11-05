// Errores de Meta (docs/06 · «Errores y qué hacer») con su traducción y la acción a tomar.

export type MetaErrorAction =
  | 'retry'            // temporal: reintentar con espera
  | 'no_retry'         // definitivo: marcar fallido
  | 'mark_invalid'     // 131026: a la segunda vez, phoneInvalid
  | 'offer_template'   // 131047: ventana cerrada
  | 'revoke_consent'   // 131050: baja
  | 'stop_campaign'    // plantilla inexistente/pausada
  | 'stop_all'         // cuenta restringida/bloqueada
  | 'critical_alert';  // número no registrado

export interface MetaErrorInfo {
  code: number;
  es: string;
  action: MetaErrorAction;
  retryable: boolean;
}

export const META_ERRORS: Record<number, MetaErrorInfo> = {
  130429: { code: 130429, es: 'Límite de envío de la API alcanzado; se reintenta más tarde', action: 'retry', retryable: true },
  131026: { code: 131026, es: 'No entregable: el número no tiene WhatsApp o no aceptó las condiciones', action: 'mark_invalid', retryable: false },
  131047: { code: 131047, es: 'La ventana de 24 h está cerrada: envía una plantilla', action: 'offer_template', retryable: false },
  131049: { code: 131049, es: 'Meta no lo entregó para proteger la experiencia del usuario (tope de marketing)', action: 'no_retry', retryable: false },
  131050: { code: 131050, es: 'El usuario ha parado los mensajes de marketing (baja)', action: 'revoke_consent', retryable: false },
  131051: { code: 131051, es: 'Tipo de mensaje no soportado', action: 'no_retry', retryable: false },
  131056: { code: 131056, es: 'Demasiados mensajes seguidos a este contacto; se reintenta más tarde', action: 'retry', retryable: true },
  132000: { code: 132000, es: 'Las variables de la plantilla no coinciden en número', action: 'no_retry', retryable: false },
  132012: { code: 132012, es: 'Las variables de la plantilla tienen un formato incorrecto', action: 'no_retry', retryable: false },
  132001: { code: 132001, es: 'La plantilla no existe o no está aprobada en ese idioma', action: 'stop_campaign', retryable: false },
  132015: { code: 132015, es: 'La plantilla está pausada por baja calidad', action: 'stop_campaign', retryable: false },
  133010: { code: 133010, es: 'El número de WhatsApp no está registrado', action: 'critical_alert', retryable: false },
  368: { code: 368, es: 'La cuenta está restringida temporalmente por Meta', action: 'stop_all', retryable: false },
  131031: { code: 131031, es: 'La cuenta de WhatsApp está bloqueada', action: 'stop_all', retryable: false },
};

/** Información del error; los desconocidos y los 5xx/red se tratan como temporales. */
export function metaErrorInfo(code: number | null | undefined, httpStatus?: number): MetaErrorInfo {
  if (code != null && META_ERRORS[code]) return META_ERRORS[code];
  if (httpStatus != null && httpStatus >= 500) {
    return { code: code ?? httpStatus, es: 'Fallo temporal de Meta; se reintenta', action: 'retry', retryable: true };
  }
  if (code == null && httpStatus == null) {
    return { code: 0, es: 'Fallo de red; se reintenta', action: 'retry', retryable: true };
  }
  return { code: code ?? 0, es: `Error de Meta ${code ?? httpStatus}`, action: 'no_retry', retryable: false };
}

/**
 * Contrato REST (prefijo /api, sesión por cookie). Las peticiones que cambian datos llevan X-Requested-With.
 * Rol: «any» = administradora y agentes; «admin» = solo administradora. Ver docs/03 · Permisos.
 * Esta lista es la fuente para el guard de roles y para las pruebas de permisos (área 8 de 08).
 */
export interface EndpointDef { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; role: 'public' | 'any' | 'admin' | 'token'; module: string; desc: string }

export const ENDPOINTS: EndpointDef[] = [
  // Sistema
  { method: 'GET', path: '/health', role: 'public', module: 'health', desc: 'Health check de Render (comprueba BD)' },
  { method: 'GET', path: '/privacidad', role: 'public', module: 'settings', desc: 'Política de privacidad SSR (RF-7.6)' },
  { method: 'GET', path: '/api/status', role: 'token', module: 'quality', desc: 'Estado para la revisión diaria (Bearer STATUS_TOKEN)' },
  { method: 'GET', path: '/webhooks/whatsapp', role: 'public', module: 'webhooks', desc: 'Verificación del webhook (hub.challenge)' },
  { method: 'POST', path: '/webhooks/whatsapp', role: 'public', module: 'webhooks', desc: 'Recepción firmada de eventos de Meta' },

  // Auth
  { method: 'POST', path: '/api/auth/login', role: 'public', module: 'auth', desc: 'Inicio de sesión' },
  { method: 'POST', path: '/api/auth/logout', role: 'any', module: 'auth', desc: 'Cierra y revoca la sesión' },
  { method: 'GET', path: '/api/auth/me', role: 'any', module: 'auth', desc: 'Usuario actual' },
  { method: 'GET', path: '/api/auth/token/:token', role: 'public', module: 'auth', desc: 'Info de un enlace de invitación/nueva contraseña' },
  { method: 'POST', path: '/api/auth/set-password', role: 'public', module: 'auth', desc: 'Crear contraseña con el enlace' },

  // Usuarios (Ajustes → Equipo)
  { method: 'GET', path: '/api/users', role: 'any', module: 'users', desc: 'Lista de usuarios (para asignar)' },
  { method: 'POST', path: '/api/users', role: 'admin', module: 'users', desc: 'Invitar (devuelve enlace)' },
  { method: 'PATCH', path: '/api/users/:id', role: 'admin', module: 'users', desc: 'Cambiar nombre, rol, activar/desactivar' },
  { method: 'POST', path: '/api/users/:id/reset-link', role: 'admin', module: 'users', desc: 'Generar enlace de nueva contraseña' },
  { method: 'POST', path: '/api/users/:id/invite-link', role: 'admin', module: 'users', desc: 'Regenerar enlace de invitación' },

  // Bandeja
  { method: 'GET', path: '/api/conversations', role: 'any', module: 'inbox', desc: 'Lista (vista, pestaña, etiqueta, búsqueda, cursor)' },
  { method: 'GET', path: '/api/conversations/counts', role: 'any', module: 'inbox', desc: 'Contadores de vistas, etiquetas y pestañas' },
  { method: 'POST', path: '/api/conversations', role: 'any', module: 'inbox', desc: 'Nueva conversación con un teléfono' },
  { method: 'GET', path: '/api/conversations/:id', role: 'any', module: 'inbox', desc: 'Detalle con contacto' },
  { method: 'GET', path: '/api/conversations/:id/timeline', role: 'any', module: 'inbox', desc: 'Mensajes y eventos (cursor hacia atrás)' },
  { method: 'POST', path: '/api/conversations/:id/messages', role: 'any', module: 'inbox', desc: 'Enviar texto, media, plantilla o nota interna' },
  { method: 'POST', path: '/api/conversations/:id/messages/:messageId/retry', role: 'any', module: 'inbox', desc: 'Reintentar un envío fallido temporal' },
  { method: 'POST', path: '/api/conversations/:id/read', role: 'any', module: 'inbox', desc: 'Marcar leída (y leído en WhatsApp)' },
  { method: 'POST', path: '/api/conversations/:id/unread', role: 'any', module: 'inbox', desc: 'Marcar como no leída' },
  { method: 'POST', path: '/api/conversations/:id/assign', role: 'any', module: 'inbox', desc: 'Asignar / quitar asignación' },
  { method: 'POST', path: '/api/conversations/:id/snooze', role: 'any', module: 'inbox', desc: 'Posponer' },
  { method: 'POST', path: '/api/conversations/:id/done', role: 'any', module: 'inbox', desc: 'Finalizar' },
  { method: 'POST', path: '/api/conversations/:id/reopen', role: 'any', module: 'inbox', desc: 'Reabrir' },
  { method: 'POST', path: '/api/conversations/:id/star', role: 'any', module: 'inbox', desc: 'Marcar / desmarcar estrella' },
  { method: 'POST', path: '/api/conversations/:id/labels', role: 'any', module: 'inbox', desc: 'Añadir/quitar etiquetas de conversación' },

  // Media y biblioteca
  { method: 'POST', path: '/api/media', role: 'any', module: 'media', desc: 'Subir archivo (multipart) → MediaFile' },
  { method: 'GET', path: '/api/media/:id/url', role: 'any', module: 'media', desc: 'URL firmada (1 h)' },
  { method: 'GET', path: '/api/library/folders', role: 'any', module: 'library', desc: 'Carpetas' },
  { method: 'POST', path: '/api/library/folders', role: 'admin', module: 'library', desc: 'Crear carpeta' },
  { method: 'PATCH', path: '/api/library/folders/:id', role: 'admin', module: 'library', desc: 'Renombrar carpeta' },
  { method: 'DELETE', path: '/api/library/folders/:id', role: 'admin', module: 'library', desc: 'Borrar carpeta vacía' },
  { method: 'GET', path: '/api/library/files', role: 'any', module: 'library', desc: 'Archivos (carpeta, búsqueda)' },
  { method: 'POST', path: '/api/library/files', role: 'admin', module: 'library', desc: 'Subir a la biblioteca' },
  { method: 'PATCH', path: '/api/library/files/:id', role: 'admin', module: 'library', desc: 'Renombrar / mover' },
  { method: 'DELETE', path: '/api/library/files/:id', role: 'admin', module: 'library', desc: 'Borrar' },

  // Contactos
  { method: 'GET', path: '/api/contacts', role: 'any', module: 'contacts', desc: 'Listado con búsqueda, filtros y paginación' },
  { method: 'POST', path: '/api/contacts', role: 'any', module: 'contacts', desc: 'Crear contacto' },
  { method: 'GET', path: '/api/contacts/export', role: 'admin', module: 'contacts', desc: 'Exportar CSV (mismos filtros)' },
  { method: 'POST', path: '/api/contacts/bulk', role: 'any', module: 'contacts', desc: 'Acciones en bloque' },
  { method: 'GET', path: '/api/contacts/:id', role: 'any', module: 'contacts', desc: 'Ficha' },
  { method: 'PATCH', path: '/api/contacts/:id', role: 'any', module: 'contacts', desc: 'Editar ficha' },
  { method: 'DELETE', path: '/api/contacts/:id', role: 'admin', module: 'contacts', desc: 'Borrado lógico (?hard=true: supresión física)' },
  { method: 'GET', path: '/api/contacts/:id/consent', role: 'any', module: 'contacts', desc: 'Historial de consentimiento' },
  { method: 'POST', path: '/api/contacts/:id/consent', role: 'any', module: 'contacts', desc: 'Cambiar consentimiento (origen y nota)' },
  { method: 'GET', path: '/api/contacts/:id/campaigns', role: 'any', module: 'contacts', desc: 'Campañas recibidas' },
  { method: 'POST', path: '/api/contacts/import', role: 'any', module: 'contacts', desc: 'Subir CSV/XLSX → columnas y muestra' },
  { method: 'POST', path: '/api/contacts/import/:jobId/preview', role: 'any', module: 'contacts', desc: 'Vista previa con mapeo y reglas' },
  { method: 'POST', path: '/api/contacts/import/:jobId/run', role: 'any', module: 'contacts', desc: 'Importar' },
  { method: 'GET', path: '/api/contacts/import/:jobId', role: 'any', module: 'contacts', desc: 'Progreso e informe' },
  { method: 'GET', path: '/api/contacts/import/:jobId/report.csv', role: 'any', module: 'contacts', desc: 'Informe descargable' },

  // Etiquetas
  { method: 'GET', path: '/api/labels', role: 'any', module: 'labels', desc: 'Etiquetas (?scope=)' },
  { method: 'POST', path: '/api/labels', role: 'any', module: 'labels', desc: 'Crear etiqueta (docs/03: crear etiquetas de contacto es de todos)' },
  { method: 'PATCH', path: '/api/labels/:id', role: 'admin', module: 'labels', desc: 'Editar etiqueta' },
  { method: 'DELETE', path: '/api/labels/:id', role: 'admin', module: 'labels', desc: 'Borrar etiqueta' },

  // Plantillas
  { method: 'GET', path: '/api/templates', role: 'any', module: 'templates', desc: 'Listado (?status=APPROVED para el chat)' },
  { method: 'POST', path: '/api/templates/sync', role: 'admin', module: 'templates', desc: 'Sincronizar con Meta' },
  { method: 'POST', path: '/api/templates', role: 'admin', module: 'templates', desc: 'Crear y enviar a revisión' },
  { method: 'GET', path: '/api/templates/:id', role: 'any', module: 'templates', desc: 'Detalle' },
  { method: 'POST', path: '/api/templates/:id/duplicate', role: 'admin', module: 'templates', desc: 'Duplicar (p. ej. con botón de baja) → borrador de editor' },
  { method: 'DELETE', path: '/api/templates/:id', role: 'admin', module: 'templates', desc: 'Borrar en Meta y localmente' },

  // Campañas
  { method: 'GET', path: '/api/campaigns', role: 'any', module: 'campaigns', desc: 'Listado' },
  { method: 'POST', path: '/api/campaigns', role: 'any', module: 'campaigns', desc: 'Crear borrador (agentes también)' },
  { method: 'POST', path: '/api/campaigns/audience-count', role: 'any', module: 'campaigns', desc: 'Recuento en vivo de audiencia' },
  { method: 'GET', path: '/api/campaigns/analytics', role: 'any', module: 'campaigns', desc: 'Comparativa entre campañas' },
  { method: 'GET', path: '/api/campaigns/:id', role: 'any', module: 'campaigns', desc: 'Detalle e informe' },
  { method: 'PATCH', path: '/api/campaigns/:id', role: 'any', module: 'campaigns', desc: 'Editar borrador' },
  { method: 'DELETE', path: '/api/campaigns/:id', role: 'admin', module: 'campaigns', desc: 'Borrar borrador' },
  { method: 'GET', path: '/api/campaigns/:id/recipients', role: 'any', module: 'campaigns', desc: 'Destinatarios con pestañas' },
  { method: 'GET', path: '/api/campaigns/:id/export', role: 'admin', module: 'campaigns', desc: 'Exportar destinatarios CSV' },
  { method: 'POST', path: '/api/campaigns/:id/test', role: 'admin', module: 'campaigns', desc: 'Envío de prueba a un número' },
  { method: 'POST', path: '/api/campaigns/:id/launch', role: 'admin', module: 'campaigns', desc: 'Lanzar o programar' },
  { method: 'POST', path: '/api/campaigns/:id/pause', role: 'admin', module: 'campaigns', desc: 'Pausar' },
  { method: 'POST', path: '/api/campaigns/:id/resume', role: 'admin', module: 'campaigns', desc: 'Reanudar' },
  { method: 'POST', path: '/api/campaigns/:id/cancel', role: 'admin', module: 'campaigns', desc: 'Cancelar' },
  { method: 'POST', path: '/api/campaigns/:id/duplicate', role: 'any', module: 'campaigns', desc: 'Duplicar como borrador' },

  // Calidad y costes
  { method: 'GET', path: '/api/quality', role: 'any', module: 'quality', desc: 'Calidad, límite, uso 24 h, histórico' },
  { method: 'GET', path: '/api/quality/costs', role: 'any', module: 'quality', desc: 'Gasto del mes (?month=YYYY-MM)' },
  { method: 'GET', path: '/api/alerts', role: 'any', module: 'quality', desc: 'Alertas activas (banner)' },

  // Ajustes
  { method: 'GET', path: '/api/settings', role: 'any', module: 'settings', desc: 'Ajustes legibles por todos (horario, tarifas…)' },
  { method: 'PUT', path: '/api/settings/:key', role: 'admin', module: 'settings', desc: 'Guardar un ajuste (validado con zod)' },
  { method: 'GET', path: '/api/settings/whatsapp', role: 'admin', module: 'settings', desc: 'Datos del número, cuenta y webhook (solo lectura)' },
  { method: 'GET', path: '/api/settings/privacy', role: 'admin', module: 'settings', desc: 'Texto actual de la política (editor)' },
  { method: 'POST', path: '/api/settings/privacy/preview', role: 'admin', module: 'settings', desc: 'Vista previa HTML saneada del Markdown de privacidad' },
  { method: 'GET', path: '/api/audit', role: 'admin', module: 'audit', desc: 'Registro de actividad filtrable' },
];

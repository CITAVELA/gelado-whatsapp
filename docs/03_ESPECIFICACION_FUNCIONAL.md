# 03 · Especificación funcional

Plataforma propia de WhatsApp para **Exclusivas Gelado** (distribuidor de peluquería, barbería y estética). Sustituye a Superchat con lo que el equipo usa de verdad: una bandeja compartida, contactos, plantillas y campañas medibles.

## Leyenda de alcance

| Marca | Significado |
| --- | --- |
| **MVP** | Pedido por el cliente en el briefing. Imprescindible para dejar Superchat |
| **MVP-P** | Propuesto por nosotros: lo usan hoy en Superchat o lo necesita otra función MVP; bajo coste. **Confirmado el 05/11/2026** (ver `10_PREGUNTAS_ABIERTAS.md`): se construye igual que MVP |
| **F2** | Fase 2, fuera de esta entrega |
| **NO** | Descartado por el cliente |

> **05/11/2026: todas las MVP-P quedan confirmadas (P3 y P4 de `10`), así que se construyen como MVP.** Donde este documento y `10_PREGUNTAS_ABIERTAS.md` no coincidan, manda `10`.

## Usuarios y roles

| Usuario | Rol | Correo (en Superchat) |
| --- | --- | --- |
| María Iborra | Administradora | gelado.comercial@gmail.com |
| Cristina Lopez | Agente | administracion2@gelado.eu |
| Lolo Gelado | Agente | geladoexclusivas@gmail.com |

- Todos ven todas las conversaciones y contactos (respuesta del cliente: «Ven todo»).
- Trabajan sobre todo desde ordenador; a veces desde el móvil (navegador).
- Decisores del proyecto: Manuel Gelado y María.

**Permisos**

| Acción | Administrador | Agente |
| --- | --- | --- |
| Bandeja, contactos, enviar mensajes y plantillas desde el chat | Sí | Sí |
| Crear y editar contactos, etiquetas de contacto, importar | Sí | Sí |
| Exportar contactos | Sí | No |
| Crear plantillas y enviarlas a Meta | Sí | No |
| Crear, programar y lanzar campañas | Sí | No (puede preparar borradores — MVP-P) |
| Ajustes, usuarios, horario, biblioteca de archivos (subir/borrar) | Sí | No (puede usar la biblioteca) |
| Borrar conversaciones o contactos | Sí | No |

## Módulos

### M1 · Acceso y cuentas — MVP

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-1.1 | Inicio de sesión con correo y contraseña; sesión larga en el navegador (cookie httpOnly) | MVP |
| RF-1.2 | Nueva contraseña **sin correo**: la administradora genera desde Ajustes un enlace de un solo uso (24 h) y se lo pasa al usuario; en el login, «¿Olvidaste tu contraseña? Pídele un enlace a la administradora» | MVP |
| RF-1.3 | La administradora invita (enlace de invitación de un solo uso, sin correo), desactiva y cambia el rol de usuarios | MVP |
| RF-1.4 | Verificación en dos pasos (TOTP) | F2 (no pedida) |
| RF-1.5 | Registro de actividad de acciones sensibles (exportar, borrar, lanzar campaña, cambiar ajustes) | MVP |

### M2 · Bandeja de entrada — MVP

Una sola bandeja para los 3 usuarios. Cada contacto de WhatsApp tiene **una conversación** (hilo único, como en WhatsApp).

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-2.1 | Lista de conversaciones con: nombre, vista previa del último mensaje, hora, no leídos, asignado, etiquetas, estrella | MVP |
| RF-2.2 | Pestañas Abiertas / Pospuestas / Finalizadas; orden por más reciente (Pospuestas: por vencimiento) | MVP |
| RF-2.3 | Vistas fijas con contador: Todas, Asignadas a mí, Sin asignar, Sin leer, Marcadas | MVP |
| RF-2.4 | **Vistas por etiqueta de cliente** en el menú lateral (Peluquería, Barbería, Estética… según etiquetas de contacto): lo que el cliente llama «bandejas separadas por etiquetas» | MVP |
| RF-2.5 | Conversación: historial con burbujas, separadores de fecha, estados de entrega (enviado, entregado, leído, fallido con motivo), mensajes citados, eventos del sistema (asignada, pospuesta, finalizada, etiquetada, por quién y cuándo) | MVP |
| RF-2.6 | **Aviso de ventana de 24 h**: cuenta atrás en la cabecera; con la ventana cerrada el compositor solo permite plantilla | MVP |
| RF-2.7 | Enviar texto (formato WhatsApp: negrita, cursiva, emojis) | MVP |
| RF-2.8 | **Adjuntos** enviar y recibir: imagen, PDF y documentos, audio, vídeo, **notas de voz** (grabadas en el navegador). En detalle: **escuchar** audios y notas de voz con reproductor en la propia conversación; **ver fotos** en miniatura y ampliadas; ver vídeos; abrir y descargar PDF y documentos; **enviar fotos y PDF desde el ordenador** (p. ej. facturas) con botón o arrastrando, varios a la vez, con pie de texto opcional | MVP (confirmado por el cliente en el briefing) |
| RF-2.9 | Mostrar todo tipo de mensaje entrante: ubicación (enlace a mapa), contacto compartido, sticker, reacción, respuesta a botón; aviso legible para tipos no soportados | MVP |
| RF-2.10 | **Enviar plantilla desde el chat** (obligatorio con la ventana cerrada, opcional con ella abierta), rellenando variables y cabecera multimedia | MVP |
| RF-2.11 | **Biblioteca de archivos** (catálogos PDF, cartas de color) para adjuntar en 2 clics, con carpetas y búsqueda | MVP (el cliente lo pide en el resumen: «catálogos predeterminados para adjuntar») |
| RF-2.12 | Asignar / reasignar / quitar asignación | MVP-P (lo usan a diario) |
| RF-2.13 | Asignación automática al responder si nadie la tiene asignada (ajuste de Superchat que tienen activado) | MVP-P |
| RF-2.14 | Etiquetas de conversación (PEDIDO, FACTURA, TRANSPORTE…) | MVP-P |
| RF-2.15 | Posponer con atajos (mañana 08:00, lunes 08:00, 1 h, 1 día, 1 semana, personalizado); vuelve a Abiertas al vencer o si el cliente escribe | MVP-P |
| RF-2.16 | Finalizar; se reabre sola si el cliente escribe | MVP-P |
| RF-2.17 | Marcar con estrella; marcar como no leído | MVP-P |
| RF-2.18 | Notas internas (no salen a WhatsApp), visibles en el historial con otro color | MVP-P |
| RF-2.19 | Búsqueda de conversaciones por nombre, teléfono o texto de mensajes | MVP-P |
| RF-2.20 | Notificaciones del navegador y sonido al entrar un mensaje; contador en la pestaña | MVP-P |
| RF-2.21 | Panel lateral con la ficha del contacto editable (ver M3) | MVP |
| RF-2.22 | Marcar como leído en WhatsApp (doble check azul para el cliente) al abrir la conversación | MVP |
| RF-2.23 | Respuestas rápidas guardadas (atajo «/») | F2 (sin prioridad en el briefing) |
| RF-2.24 | Spam / papelera / borrar conversación | F2 (borrar contacto en M3 cubre el caso) |
| RF-2.25 | Mensajes programados y borradores en el chat | F2 |
| RF-2.26 | Historial de Superchat importado | F2 (depende de si Superchat permite exportarlo; ver preguntas) |
| RF-2.27 | Chat interno del equipo | F2 (prioridad «Baja») |

### M3 · Contactos — MVP

Hoy: **6.560 contactos**, que el cliente considera «muy valiosos».

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-3.1 | Ficha: nombre, apellidos, teléfono móvil (E.164, único), correo, **Código** (código de cliente), **DNI/CIF**, teléfono fijo, empresa, notas, etiquetas, estado de consentimiento, nombre de perfil de WhatsApp (solo lectura) | MVP |
| RF-3.2 | Listado con búsqueda (nombre, teléfono, código, CIF), filtros por etiqueta y consentimiento, columnas, paginación | MVP |
| RF-3.3 | **Importar CSV/Excel** con asistente: subir, mapear columnas, previsualizar, normalizar teléfonos a E.164 (España por defecto), deduplicar por teléfono, informe de filas creadas/actualizadas/descartadas con motivo | MVP |
| RF-3.4 | Exportar CSV (todo o filtrado) — solo administradora | MVP-P (Superchat lo tiene; necesario para salida de datos y RGPD) |
| RF-3.5 | **Etiquetas de contacto** (tipo de cliente: PELUQUERÍA, BARBERÍA, ESTÉTICA, INSTITUTO, JUBILADO…). Sustituyen a las «listas» de Superchat | MVP |
| RF-3.6 | **Registro de consentimiento y bajas**: estado (sin constancia / con consentimiento / dado de baja), fecha, origen y quién lo cambió; historial. **Todo contacto que no esté dado de baja recibe marketing** (P6) | MVP |
| RF-3.7 | **Bajas automáticas (opt-out)**: botón «No recibir más» en plantillas de marketing, palabras clave («BAJA», «STOP»), error 131050 de Meta y la etiqueta heredada NO PUBLICIDAD. Un contacto dado de baja **nunca** entra en una campaña | MVP |
| RF-3.8 | Crear contacto desde una conversación nueva (el que escribe por primera vez se crea solo) | MVP |
| RF-3.9 | Atributos personalizados configurables por la administradora | F2 (los 3 propios de hoy van como campos fijos) |
| RF-3.10 | Sincronización con CRM/ERP | NO (no pedido) |

### M4 · Plantillas — MVP

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-4.1 | Sincronizar las plantillas existentes de la cuenta de WhatsApp (12 hoy) y mantener su estado al día por webhook | MVP |
| RF-4.2 | **Crear plantilla y enviarla a revisión de Meta**: nombre, categoría (Marketing/Utilidad), idioma, cabecera (texto, imagen, vídeo o documento), cuerpo con variables y ejemplos, pie, botones (respuesta rápida, enlace con o sin variable, llamada) | MVP |
| RF-4.3 | Vista previa tipo WhatsApp mientras se edita | MVP |
| RF-4.4 | Estado: pendiente, aprobada, rechazada (con motivo), pausada, desactivada; aviso si una plantilla en uso se pausa | MVP |
| RF-4.5 | **Botón «No recibir más» obligatorio** en toda plantilla de marketing nueva (la LSSI exige un medio sencillo y gratuito de baja en cada comunicación comercial). Las plantillas de marketing actuales que no lo tengan se marcan «Sin botón de baja» y no se pueden usar en campañas hasta duplicarlas con el botón | MVP |
| RF-4.6 | Carpetas de plantillas | F2 |
| RF-4.7 | Editar plantillas aprobadas, duplicar, borrar | Borrar y duplicar: MVP-P · Editar: F2 |

### M5 · Campañas — MVP (uso principal)

Volumen real: campañas de 241 a 1.509 destinatarios, casi semanales; 1.394 mensajes de marketing en el último mes.

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-5.1 | Listado: nombre, estado, destinatarios, creada por, fecha de envío, resultado resumido | MVP |
| RF-5.2 | Asistente: nombre interno → plantilla con botón de baja (y variables mapeadas a campos del contacto o texto fijo; cabecera multimedia) → **audiencia** por etiquetas de contacto (incluir/excluir) y filtros, con recuento en vivo → cuándo (ahora o programada) → resumen con coste estimado → confirmar y lanzar | MVP |
| RF-5.3 | Exclusiones automáticas: dados de baja (siempre, sin excepción), teléfonos inválidos y duplicados. El resto de contactos de la audiencia recibe la campaña (P6) | MVP |
| RF-5.4 | Envío de prueba a un número antes de lanzar | MVP |
| RF-5.5 | **Envío escalonado**: ritmo configurable (por defecto 20 mensajes/minuto), respetando el límite de Meta de usuarios únicos en 24 h (hoy 2.000 a nivel de portfolio); si la audiencia lo supera, la campaña se reparte en varios días automáticamente y lo avisa | MVP |
| RF-5.6 | Pausar, reanudar y cancelar una campaña en curso; parada automática ante errores graves (plantilla pausada, cuenta restringida, calidad baja) | MVP |
| RF-5.7 | **Informe**: embudo enviados → entregados → leídos → respondidos, fallidos con motivo, bajas generadas, coste estimado; lista de destinatarios con pestañas (Todos, Entregado, Leído, Respondido, Fallido) y búsqueda; abrir conversación desde la lista; exportar CSV | MVP |
| RF-5.8 | Borradores | MVP |
| RF-5.9 | Respuestas a la campaña entran en la bandeja como conversación normal, marcadas con el nombre de la campaña | MVP |
| RF-5.10 | Duplicar campaña | MVP-P |
| RF-5.11 | Automatizaciones tras campaña (p. ej. etiquetar a quien responde) | F2 |

### M6 · Calidad, límites y costes — MVP

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-6.1 | Mostrar calidad del número (verde/amarillo/rojo), estado y límite de mensajes; histórico | MVP |
| RF-6.2 | **Aviso** en la app (banner visible para todos los usuarios) si baja la calidad, se marca el número, se pausa una plantilla o la cuenta tiene un aviso; sin correo en el MVP. Endpoint protegido `/api/status` para la revisión diaria automática de Claude | MVP |
| RF-6.3 | Analítica de campañas (comparativa entre campañas: entregados %, leídos %, respuestas %, bajas %) | MVP |
| RF-6.4 | Gasto estimado en Meta por mes y por categoría, calculado con los datos de facturación que manda Meta en cada estado | MVP-P |
| RF-6.5 | Panel general (mensajes por periodo, tiempo de respuesta, carga por persona) | F2 |

### M7 · Ajustes y automatización mínima

| ID | Requisito | Alcance |
| --- | --- | --- |
| RF-7.1 | Horario de atención por día con dos tramos (hoy: L–V 09:00–14:00 y 17:00–20:00, S 09:30–13:30, D cerrado), zona Europe/Madrid | MVP-P |
| RF-7.2 | **Respuesta automática fuera de horario** (mensaje libre, gratis dentro de la ventana) con botones, como la que usan hoy; como mucho una vez cada 12 h por contacto. **Encendida desde el primer día** (P3) | MVP |
| RF-7.3 | Modo vacaciones: mensaje y fecha de vuelta entre dos fechas; construido y apagado | MVP |
| RF-7.4 | Etiquetas (crear, color, ámbito contacto/conversación), biblioteca de archivos, usuarios | MVP |
| RF-7.5 | Mensaje de bienvenida, reglas, reparto automático, IA, copiloto | NO (el cliente: «responderán ellos manualmente… nada de IA de momento») |
| RF-7.6 | **Página pública de privacidad** en `/privacidad`, sin inicio de sesión y renderizada en el servidor (HTML completo sin depender de JavaScript, para que la lea el revisor de Meta). Incluye la sección de supresión de datos con ancla `#supresion`. El texto es el ajuste `privacy_policy` (Markdown), con el contenido inicial de `docs/legal/politica-privacidad.md`, y la administradora lo edita en Ajustes → Privacidad con vista previa y **sin desplegar**. Enlace «Privacidad» en el pie del inicio de sesión. Es requisito de Meta para pasar la app a modo Live (`09`, D6). Las peticiones de supresión llegan como mensaje normal a la bandeja y se atienden con el borrado de contacto de la administradora (regla 7 de `05`) | MVP |

### M8 · Reseñas de Google — fuera del MVP (P5: se pide el acceso a Google ya)

El cliente incluye «Reseñas» en el resumen MVP. En Superchat ven y responden las reseñas de Google del perfil «Exclusivas Gelado SL».

- Requiere la API de Google Business Profile, cuyo acceso hay que **solicitar a Google y esperar aprobación** (plazo no controlable).
- Propuesta: se diseña el módulo (ver y responder reseñas, filtro sin respuesta) pero **queda fuera de la entrega MVP** hasta que Google dé acceso; mientras, un acceso directo al perfil de empresa. Ver `10_PREGUNTAS_ABIERTAS.md`.

### Fuera de alcance

Otros canales (Instagram, Messenger, email, chat web, SMS, Telegram), segundo número, IA de cualquier tipo, catálogo de productos de WhatsApp, pedidos y pagos, ERP o tienda online, Zapier/Make, app nativa (la web será responsive y usable en el móvil).

## Reglas de negocio transversales

1. **Ventana de 24 h:** se abre o renueva con cada mensaje **del cliente**. Fuera de ella solo plantillas.
2. **Nunca se envía marketing a un contacto dado de baja.** La baja manda sobre cualquier selección manual.
3. **Un teléfono = un contacto = una conversación.** Teléfono en E.164.
4. **Todo lo que pasa en una conversación queda en su historial** (quién asignó, pospuso, finalizó, etiquetó).
5. **Idioma de la interfaz:** español. Zona horaria Europe/Madrid. Moneda de costes: **EUR** (la de la cuenta de WhatsApp).
6. **Coste:** antes de lanzar una campaña se muestra el coste estimado con la tarifa configurada (marketing España 0,0585 € a 05/11/2026; editable en ajustes).
7. **Baja en cada comunicación comercial:** toda plantilla de marketing que se envíe en campaña lleva el botón «No recibir más».
8. **Sin correo saliente en el MVP:** invitaciones y nuevas contraseñas por enlace generado en la app; avisos solo dentro de la app.

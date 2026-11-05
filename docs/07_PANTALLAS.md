# 07 · Pantallas

Descripción de cada pantalla del MVP para el desarrollo y para preparar maquetas. Estilo: limpio, denso de información, pensado para escritorio (1366–1920 px) y usable en el móvil. Interfaz en español. Marca: logo «GELADO» (fondo negro, letras blancas, G coral) — pedir el logo en alta al cliente.

> **Principio de diseño (05/11/2026): parecerse a Superchat en distribución, nombres y flujos** para que el equipo no tenga que aprender nada nuevo: menú lateral de iconos, bandeja en tres columnas con «Abiertos / Pospuestas / Finalizadas», menú «…» de conversación con las mismas acciones y el mismo orden, «Asignado a mí», «No asignado», «Sin leer», «Marcado», campañas con «Nueva campaña» y embudo Entregado/Leído, ajustes con el mismo menú. La identidad visual (colores, logo, tipografía) es la de Gelado, no la de Superchat. Las maquetas aprobadas están en `docs/maquetas/`.

## Estructura general

- **Barra lateral izquierda fija** (iconos + texto en escritorio, menú inferior en móvil): Bandeja · Contactos · Campañas · Plantillas · Calidad · Ajustes (solo admin). Abajo: usuario y cerrar sesión.
- **Banner de alerta** en la parte superior cuando la calidad del número no es verde, una plantilla en uso está pausada o la cuenta tiene un aviso (rojo/ámbar, con enlace a Calidad).
- Contador de no leídos en el título de la pestaña del navegador: `(17) Gelado WhatsApp`.

## P1 · Inicio de sesión

Correo y contraseña; debajo «¿Olvidaste tu contraseña? Pídele un enlace a la administradora». Pie con el enlace «Privacidad» (`/privacidad`). Pantalla «Crear contraseña» al abrir un enlace de invitación o de nueva contraseña (generados por la administradora en Ajustes → Equipo).

## P2 · Bandeja (tres columnas)

**Columna 1 — vistas** (plegable)
- Todas · Asignadas a mí · Sin asignar · Sin leer · Marcadas, cada una con contador.
- «Por tipo de cliente»: Peluquería · Barbería · Estética · Instituto · Jubilado (etiquetas de contacto con `showAsInboxView`), con contador.

**Columna 2 — lista**
- Buscador (nombre, teléfono, texto).
- Pestañas Abiertas · Pospuestas · Finalizadas. Orden: más reciente (Pospuestas: vence antes).
- Filtro rápido por asignado y por etiqueta de conversación.
- Tarjeta: avatar con iniciales · nombre (o teléfono) · hora · vista previa (con icono si es adjunto o plantilla) · chips de etiqueta · contador de no leídos · avatar del asignado · estrella · icono de reloj si la ventana de 24 h caduca en menos de 2 h.
- Menú «…» en la tarjeta: Finalizar · Marcar · Posponer › · Asignar › · Etiquetar › · Marcar como no leído.

**Columna 3 — conversación**
- Cabecera: nombre + chips de etiquetas del contacto · teléfono · **«Ventana abierta: quedan 22 h»** o **«Ventana cerrada: solo plantillas»** · botones Asignar · Etiquetar · Posponer · Finalizar · Ficha (abre panel lateral).
- Historial: burbujas (entrantes a la izquierda, salientes a la derecha con nombre del usuario que envió y checks de estado; fallidos en rojo con el motivo y botón «Reintentar» si es temporal), notas internas en amarillo, eventos del sistema centrados en gris, separadores de fecha, mensajes citados, reacciones, adjuntos con vista previa (imagen en miniatura ampliable, PDF con icono y nombre, reproductor de audio y vídeo).
- Compositor (ventana abierta): caja de texto (Enter envía, Mayús+Enter salto de línea) · pestaña «Nota interna» · emoji · adjuntar (de la biblioteca o del ordenador, arrastrar y soltar) · grabar nota de voz · plantilla.
- Compositor (ventana cerrada): mensaje explicativo + botón «Enviar plantilla».
- **Modal de plantilla**: lista de plantillas aprobadas con buscador y vista previa; formulario de variables (rellenadas con datos del contacto si se puede); cabecera multimedia (de la biblioteca o subir); coste estimado del envío; Enviar.
- **Modal de biblioteca**: carpetas (Catálogos…), buscador, vista previa, seleccionar uno o varios.

**Panel lateral de ficha** (derecha, plegable): datos del contacto editables, etiquetas de contacto, consentimiento (estado, fecha, origen, historial), últimas campañas recibidas.

**Estados vacíos**: «No hay conversaciones abiertas. ¡Todo al día!» · «Selecciona una conversación».

## P3 · Contactos

- Cabecera: «Contactos (6.560)» · Importar · Exportar (admin) · Nuevo contacto.
- Barra: buscador · filtros (etiquetas incluir/excluir, consentimiento, **Con / sin WhatsApp**, teléfono inválido) · selector de columnas.
- Tabla: casilla · nombre · teléfono (los contactos sin teléfono llevan el chip gris **«Sin WhatsApp»**) · código · CIF/DNI · teléfono fijo · etiquetas · consentimiento (chip verde/gris/rojo) · última actividad. Paginación de 100.
- Acciones en bloque: añadir/quitar etiqueta, cambiar consentimiento (pide origen y nota), exportar selección (admin).
- **Ficha** (página o panel): todos los campos, etiquetas, consentimiento con historial, botón «Abrir conversación» (deshabilitado con «Sin WhatsApp» si no hay teléfono), campañas recibidas. «Nuevo contacto» pide teléfono **o** correo.
- **Asistente de importación**: 1) subir CSV/XLSX → 2) mapear columnas (detecta Nombre, Apellido, Teléfono, Correo, Código, DNI, Teléfono Fijo, Listas, Etiqueta, Notas; ID, Género, últimos mensajes y campañas de Superchat van a «No importar»; basta con teléfono, correo o código) → 3) reglas (país por defecto ES, qué hacer con duplicados: actualizar/omitir, qué etiqueta poner, cómo tratar NO PUBLICIDAD, consentimiento inicial) → 4) vista previa con el recuento «Sin WhatsApp», los avisos por tipo (país distinto de España, fijo español, teléfono corregido, incompleto) y los errores → 5) importar con barra de progreso → 6) informe descargable (con el tipo de cada aviso). En el asistente de campañas el recuento añade «x sin WhatsApp».

## P4 · Campañas

- **Listado**: nombre · estado (Borrador, Programada, Enviando x %, Pausada, Completada, Cancelada) · destinatarios · creada por · fecha · entregados % · leídos %. Botón «Nueva campaña» (admin).
- **Asistente** (una página con secciones, como en Superchat):
  1. Detalles: nombre interno.
  2. Contenido: plantilla aprobada (con vista previa a la derecha); variables mapeadas a campos del contacto con texto de respaldo; cabecera multimedia.
  3. Destinatarios: incluir etiquetas · excluir etiquetas · recuento en vivo con desglose («1.522 seleccionados · 37 excluidos por baja · 4 teléfonos inválidos → **1.481 recibirán el mensaje**»).
  4. Envío: ahora o fecha y hora; ritmo (por defecto 20/min, duración estimada); aviso si supera el límite diario de Meta y reparto en días.
  5. Resumen: coste estimado y confirmación. Solo se pueden elegir plantillas de marketing con botón «No recibir más»; las que no lo tienen aparecen deshabilitadas con «Duplicar con botón de baja».
  - Botones: Guardar borrador · Enviar prueba (a un número) · Lanzar / Programar.
- **Detalle**: datos de la campaña · tarjetas Enviados / Entregados % / Leídos % / Respondidos % / Fallidos / Bajas / Coste · gráfico de embudo · motivos de fallo agrupados · tabla de destinatarios con pestañas (Todos, Entregado, Leído, Respondido, Fallido, Omitido) y buscador, enlace a la conversación · Exportar CSV · Pausar / Reanudar / Cancelar · Duplicar.

## P5 · Plantillas

- **Listado**: nombre legible · nombre en Meta · categoría · idioma · estado (chip) · calidad · última actualización. Botones «Sincronizar» y «Nueva plantilla» (admin).
- **Editor** (dos columnas, formulario + vista previa tipo WhatsApp en vivo): nombre legible (genera el nombre de Meta) · categoría · idioma · cabecera (ninguna/texto/imagen/vídeo/documento) · cuerpo con barra de formato y botón «Añadir variable» (pide ejemplo) · pie · botones (respuesta rápida, enlace, llamada; máx. según Meta) · casilla «Añadir botón No recibir más» (marcada en Marketing) · contadores de caracteres · Enviar a revisión.
- Estado rechazado: muestra el motivo de Meta y permite duplicar y corregir.

## P6 · Calidad y costes

- Estado del número: calidad (semáforo), estado, límite actual de usuarios/24 h, uso de las últimas 24 h.
- Histórico de calidad.
- Gasto estimado del mes: por categoría y por campaña; mensajes de servicio usados del cupo gratuito (x / 1.000).
- Comparativa de campañas (tabla): entregados %, leídos %, respondidos %, bajas %.

## P7 · Ajustes (admin)

- **Equipo**: lista, invitar (genera enlace para copiar), rol, desactivar, «Generar enlace de nueva contraseña».
- **Etiquetas**: dos pestañas (Tipo de cliente / Conversación); nombre, color, mostrar como bandeja.
- **Biblioteca**: carpetas y archivos (subir, renombrar, mover, borrar).
- **Horario y respuestas automáticas**: horario por día (dos tramos), respuesta fuera de horario (activar, texto, botones, vista previa), modo vacaciones (fechas, texto).
- **WhatsApp**: datos del número y de la cuenta (solo lectura), estado del webhook (último evento recibido), tarifas de Meta editables.
- **Privacidad**: editor de la política (Markdown) con vista previa, botón «Ver página pública» y aviso si quedan campos entre corchetes sin rellenar (`[CIF]`, `[domicilio social]`…).
- **Registro de actividad**: tabla filtrable.

## P8 · Página pública de privacidad

`/privacidad`, sin sesión: logo de Gelado, el texto del ajuste `privacy_policy` con buena tipografía de lectura, títulos con ancla (la de supresión es `#supresion`) y fecha de actualización. Sin menú de la aplicación. Se ve bien en el móvil.

## Comportamiento en el móvil

- Bandeja en una sola columna: lista → conversación → ficha, con navegación atrás.
- Compositor fijo abajo; grabar nota de voz manteniendo pulsado.
- Campañas y plantillas: consulta completa; crear campañas recomendado en escritorio.

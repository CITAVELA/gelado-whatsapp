# 02 · Inventario de Superchat (ingeniería inversa funcional)

Fuente: 37 capturas de la cuenta de Superchat de Exclusivas Gelado tomadas el 05/11/2026 (capturas 393–429) y el briefing relleno por el cliente.
Objetivo: dejar constancia de lo que hace hoy cada pantalla y qué requisito sale de ella. Lo que se construye se decide en `03_ESPECIFICACION_FUNCIONAL.md`; este documento solo describe.

> Nota de método: se reproduce el **comportamiento** observable, no el diseño ni el código de Superchat. La interfaz nueva será propia.

## Datos reales que aparecen en las capturas

| Dato | Valor observado |
| --- | --- |
| Usuarios | María Iborra (Administrador), Cristina Lopez (Supervisor), Lolo Gelado (Supervisor) |
| Buzón | Uno solo, «Central», con el canal API de WhatsApp Business «Exclusivas Gelado» |
| Contactos | 6.560 (66 páginas de 100) |
| Listas de contactos | BARBERÍA 353 · ESTÉTICA 292 · PELUQUERÍA 1.522 |
| Etiquetas | BARBERÍA, ESTÉTICA, FACTURA, INSTITUTO, JUBILADO, NO PUBLICIDAD, PEDIDO, PELUQUERÍA, TRANSPORTE (cada una con color) |
| Atributos de contacto | Sistema: Nombre, Apellido, Teléfono, Correo, Género · Propios: Código (número), DNI (texto), Teléfono fijo (número) |
| Plantillas (12, todas Marketing, español, aprobadas) | Carpeta CAMPAÑAS: ACADEMIA de BARBERÍA Corte 0, Campaña Imagen, Campaña Imagen Copie, Campaña PDF y ENLACE, ENLACE Y FOTO · Carpeta Fuera de Horario: Cierre de Ventana 24h, VACACIONES · Sin carpeta: Buenas Tardes, Buenos días, Imágen y Texto, Inicio de Conversación, Mandar PDF |
| Campañas recientes | Tintes KUKIT + Toallitas y Oxi (1.489 dest., 20/10/2026) · FACIAL Tassel Hyaluronic y Kukit Orange (241, 13/10) · CAMPAÑA SUNLAKE Antiyellow/Allinone (1.509, 18/09) · 2 borradores (Afeitadora Z-TECH RAGNAR 298, CHROMACID Tinte Dousse Ácido 1.357) |
| Resultado campaña KUKIT | 1.238 entregados (83 %) · 780 leídos (52 %) · 251 no recibidos («no usan WhatsApp») |
| Biblioteca de archivos | Carpeta «Catálogos» con PDF de marcas (ALLE LAC, CRAZY COLOR, DARNIER, DOUSSE ×3, Eléctrico RAGNAR, ELEGANCE…) |
| Horario | L–V 09:00–14:00 y 17:00–20:00 · S 09:30–13:30 · D cerrado · Europe/Madrid |
| Automatizaciones | VACACIONES, Ausencia, BLACK BARBER – Black Friday 2025 (las tres en pausa) |
| Ajustes | Asignación automática al responder: «Asignar solo si nadie ha sido asignado aún» · Función IA activada (el cliente no quiere IA) |

## Pantalla por pantalla

### Bandeja de entrada (capturas 393–400, 413–415, 417)

| Elemento | Qué hace hoy | Requisito que se deriva |
| --- | --- | --- |
| Menú lateral de vistas | Borradores y programados · Todas (17) · Asignado a mí (3) · No asignado (1) · Sin leer (17) · Marcado (1) · Papelera · Spam · Buzones (Central) · Filtros guardados | Vistas fijas con contador + vistas por etiqueta de cliente (lo que el cliente llama «bandejas por etiqueta») |
| Pestañas de la lista | Abiertos · Pospuestas · Finalizadas; orden «Más reciente» / «Próximamente vence»; filtro | Estados de conversación: abierta, pospuesta (con fecha), finalizada |
| Tarjeta de conversación | Nombre, buzón, vista previa del último mensaje, hora, contador de no leídos, avatar del asignado, chips de etiqueta, estrella | Mismo contenido mínimo en la lista |
| Menú «…» de conversación | Marcar como finalizada · Marcado · Pospuestos › · Asignar › · Etiqueta › · Marcar como no leído · Informar sobre spam · Mover a la papelera · Borrar permanentemente | Acciones de conversación (spam/papelera/borrar → ver especificación) |
| Posponer | Mañana 08:00 · Lunes 08:00 · 1 hora · 1 día · 1 semana · 1 mes · 1 año · Personalizado | Posponer con atajos + fecha libre; reaparece en Abiertos al vencer |
| Asignar | Buscador · No asignado · usuarios del equipo | Asignación a un usuario o a nadie |
| Etiquetar | Buscador · Sin etiqueta · lista de etiquetas con color (multiselección) | Etiquetas múltiples por conversación |
| Cabecera del chat | Nombre + etiqueta, «22h para responder» / «2 min para responder», acciones (asignar, etiqueta, posponer, finalizar, más) y panel de información | **Cuenta atrás de la ventana de 24 h** visible siempre |
| Historial | Burbujas entrantes/salientes con doble check, separadores de fecha, eventos del sistema («Cristina Lopez ha marcado el chat como Hecho», «ha pospuesto el chat hasta…»), mensajes de plantilla con imagen y botones de respuesta rápida, mensajes citados (respuesta a un mensaje) | Línea de tiempo con mensajes, estados de entrega, eventos y citas |
| Mensajes no soportados | «Este mensaje no es compatible» (p. ej. +447974905007, +34603324559) | Mostrar siempre algo útil por tipo (ubicación, contacto, sticker, reacción…) y un aviso genérico para lo desconocido |
| Compositor (ventana abierta) | Texto con sugerencia («Hola Ginés» + Tab), Nota interna, emoji, GIF, adjuntar, grabar audio, plantilla, favoritos, respuestas rápidas (rayo), IA, Enviar con desplegable | Texto, adjuntos, nota de voz, plantilla, nota interna |
| Compositor (ventana cerrada) | Solo «Elige una plantilla de WhatsApp» | Bloquear texto libre y forzar plantilla |
| Adjuntar | Modal: elegir de la biblioteca («Catálogos») o subir/arrastrar | Biblioteca de archivos reutilizables en el chat |
| Panel de atributos | Nombre, Apellido, Correo, Teléfono, Género, Nombre de usuario, Código, DNI, Teléfono fijo (editables) | Ficha de contacto lateral editable |

### Campañas (capturas 401–405)

| Elemento | Qué hace hoy | Requisito |
| --- | --- | --- |
| Listado | Nombre, Estado (Borrador/Enviado), Destinatarios, Creado por, Fecha de envío, menú | Listado de campañas con estados |
| Nueva campaña | Nombre interno · Número de WhatsApp · Plantilla (o crear nueva) · Seleccionar destinatarios · Automatización (opcional) · Cuándo: inmediatamente o programada · **Declaración de inscripción** (casilla de consentimiento) · Guardar borrador · Enviar mensaje de prueba · Enviar | Asistente de campaña con borrador, prueba y programación (la declaración de consentimiento no se replica: P6) |
| Detalle | Estado, creador, número, fecha, destinatarios, tipo · Embudo Entregado/Leído (+ añadir métricas) · aviso de no recibidos · lista de destinatarios con pestañas Todos/Recibido/Leído/Respondido/Fallida, búsqueda, filtro, abrir chat/contacto · descarga | Informe de campaña con embudo y lista filtrable exportable |

### Automatizaciones (capturas 406–407)

| Elemento | Qué hace hoy | Requisito |
| --- | --- | --- |
| Listado | Nombre, creador, última edición, estado (todas en pausa); límite del plan 0/1 | — |
| Flujo VACACIONES | Disparador «nueva o reabierta conversación» → «Horario de apertura» (dentro/fuera) → «Enviar plantilla VACACIONES» con variable de fecha y botón «Dale un ojo a la WEB» | Cubierto con un ajuste simple de **respuesta automática fuera de horario / vacaciones** (no un editor de flujos) |

### Contactos (capturas 408, 416, 418)

| Elemento | Qué hace hoy | Requisito |
| --- | --- | --- |
| Listado | Buscar, Añadir filtro, Ver (columnas), tamaño de página, Exportar todo, Importar, Nuevo contacto | Listado con búsqueda, filtros, exportar e importar |
| Columnas | Nombre, Código, DNI, Teléfono, Teléfono fijo, Listas, Etiqueta, Correo… | Campos de la ficha |
| Calidad de datos | Muchos nombres son emojis o el nombre de perfil de WhatsApp; empresas con CIF en «DNI» (p. ej. 2002 FRASCOS SL, B62781927) | Importación con limpieza mínima; el nombre de perfil de WhatsApp no sustituye al nombre guardado |
| Listas | BARBERÍA, ESTÉTICA, PELUQUERÍA (gestionar/crear) | Se unifican con etiquetas de contacto (ver especificación) |

### Reseñas (captura 409)

Reseñas de Google del perfil «Exclusivas Gelado SL» con estrellas, texto y fecha; pestañas Todos/Sin respuesta/Respuesta; acciones Respuestas e Informe. Requiere la API de Google Business Profile (ver especificación y preguntas abiertas).

### Configuración (capturas 410–412, 419–429)

| Pantalla | Qué hace hoy | Requisito |
| --- | --- | --- |
| Etiquetas | Crear, editar, color, carpetas | CRUD de etiquetas con color |
| Archivos | Subir archivo, carpetas, tipo, añadido por, fecha | Biblioteca con carpetas |
| Plantillas de WhatsApp | Listado con carpetas, estado, idioma | Gestor de plantillas sincronizado con Meta |
| Editor de plantilla | Cuenta · nombre interno · nombre en Meta (`cierre_de_ventana_24h_22690_1763200411`) · categoría · idioma · mensaje con formato y variables («Comodín») · archivo/título (cabecera) · pie (60 car.) · hasta 10 botones (respuesta rápida 25 car., enlace…) · vista previa | Editor con vista previa tipo WhatsApp |
| Atributos de contacto | Sistema + propios con tipo (Número, Campo de texto) | Campos propios configurables (MVP: fijos; ver especificación) |
| Área de trabajo | Logo, nombre, idioma, zona horaria, asignación automática al responder, función IA | Ajustes generales |
| Equipo | Invitar, roles Administrador/Supervisor, acceso a buzones, estado de ausencia, copiloto IA | Gestión de usuarios con 2 roles |
| Buzón Central | Canal API de WhatsApp · Mensaje de bienvenida (apagado) · Horario de apertura y fuera de oficina (encendido, con el horario) · Mensaje de fuera de oficina (apagado) · Acceso al buzón | Horario de atención + respuesta fuera de horario configurable |

## Lo que el cliente usaba de verdad (deducido)

- **Muy usado:** campañas de plantilla con imagen a ~1.500 contactos (casi semanales), bandeja con asignación, etiquetas, posponer y finalizar, biblioteca de catálogos en PDF.
- **Usado:** respuesta fuera de horario con botones («Quiero hacer un Pedido», «Necesito Factura/s», «Tengo una Duda o Consulta»), automatización de vacaciones en agosto, reseñas de Google.
- **Sin uso o marginal:** chat de equipo, agentes de IA, mensaje de bienvenida, varios buzones.

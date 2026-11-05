# 06 · Integración con WhatsApp (Meta Cloud API)

Todo va por la **API oficial de Meta (Cloud API / Graph API)** con la app de Meta del cliente. Nada de librerías no oficiales (Baileys, WAHA, whatsapp-web.js…): el número ya está en la API y otra cosa podría bloquearlo.

> Antes de implementar, revisar la documentación vigente de Meta (developers.facebook.com → WhatsApp Business Platform) para la versión de la Graph API, los campos del webhook y los límites. Este documento resume lo necesario a 05/11/2026; donde Meta diga otra cosa, manda Meta.

## Configuración

| Variable | Valor / origen |
| --- | --- |
| `GRAPH_API_VERSION` | Versión vigente al empezar (constante única en el código) |
| `WA_PHONE_NUMBER_ID` | `833139829886325` |
| `WA_WABA_ID` | `24936790469294569` |
| `META_BUSINESS_ID` | `115003938195726` |
| `META_APP_ID` / `META_APP_SECRET` | App nueva creada en el Business Manager del cliente |
| `WA_SYSTEM_USER_TOKEN` | Token permanente del usuario de sistema con `whatsapp_business_messaging` y `whatsapp_business_management` |
| `WA_VERIFY_TOKEN` | Cadena aleatoria para la verificación del webhook |

Puesta en marcha (detalle en `09`): suscribir la app a la WABA (`POST /{WABA_ID}/subscribed_apps`), configurar la URL del webhook y el verify token en la app, y suscribir los campos. **No llamar nunca a `/register`**: el número ya está registrado y pediría el PIN de verificación en dos pasos.

## Webhook

### Verificación (GET)

`GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → si el token coincide, responder `200` con `hub.challenge` en texto plano; si no, `403`.

### Recepción (POST)

1. Leer el **cuerpo crudo** y verificar `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(cuerpo crudo, `META_APP_SECRET`), comparación en tiempo constante. Sin firma válida → `401` y no se procesa.
2. Guardar el evento en `WebhookEvent` y encolar `wa.inbound`. Responder **200 en menos de 1 s**. Meta reintenta si no hay 200, así que el procesamiento debe ser **idempotente**.
3. Ignorar cambios cuyo `value.metadata.phone_number_id` no sea el nuestro.

### Campos a suscribir

| Campo | Para qué |
| --- | --- |
| `messages` | Mensajes entrantes y estados de los salientes (`statuses`) |
| `message_template_status_update` | Plantilla aprobada, rechazada, pausada, desactivada |
| `message_template_quality_update` | Calidad de cada plantilla |
| `template_category_update` | Meta cambia la categoría de una plantilla |
| `phone_number_quality_update` | Cambios de calidad o de límite del número → alerta |
| `account_update` | Restricciones o avisos de la cuenta → alerta |

### Mensajes entrantes (`value.messages[]`)

Estructura: `value.contacts[0]` (`wa_id`, `profile.name`) + `value.messages[0]` (`from`, `id` = wamid, `timestamp`, `type`, `context` si es respuesta).

| `type` | Qué guardar (`Message.kind`) |
| --- | --- |
| `text` | TEXT · `text.body` |
| `image`, `video`, `document`, `sticker` | IMAGE/VIDEO/DOCUMENT/STICKER · `id` de media, `mime_type`, `sha256`, `caption`, `filename` → encolar descarga |
| `audio` | AUDIO o VOICE (si `audio.voice` es true) · descarga |
| `location` | LOCATION · latitud, longitud, nombre, dirección (mostrar enlace a mapa) |
| `contacts` | CONTACTS · tarjeta(s) de contacto |
| `button` | BUTTON_REPLY · `button.text` y `button.payload` (respuesta a botón de plantilla) |
| `interactive` | BUTTON_REPLY · `button_reply.id/title` o `list_reply` |
| `reaction` | REACTION · `emoji` y `message_id` al que reacciona (mostrar sobre ese mensaje) |
| `order`, `system`, `unsupported`, otros | UNSUPPORTED · guardar `raw` y mostrar «Tipo de mensaje no soportado: X» |

Al recibir cualquier mensaje entrante:

1. Buscar o crear el contacto por `wa_id`/teléfono; actualizar `profileName` (sin pisar `firstName`).
2. Buscar o crear la conversación; si estaba DONE o SNOOZED → OPEN (evento REOPENED/WOKE_UP).
3. `lastInboundAt = timestamp`, `windowExpiresAt = +24 h`, `unreadCount++`, vista previa.
4. Comprobar **baja**: payload `OPT_OUT`, o texto que sea exactamente una palabra clave (`baja`, `stop`, `no quiero recibir`…, sin distinguir mayúsculas ni tildes) → `consentStatus = REVOKED` + `ConsentEvent` + evento en la conversación + confirmación automática al cliente («Te hemos dado de baja de las promociones…»).
5. Si es respuesta a una campaña (la conversación tiene envío de campaña en las últimas 72 h) → marcar `CampaignRecipient.repliedAt`.
6. Respuesta automática fuera de horario / vacaciones si toca (ver más abajo).
7. Emitir por WebSocket.

### Estados de mensajes salientes (`value.statuses[]`)

Campos: `id` (wamid), `status` (`sent`, `delivered`, `read`, `failed`), `timestamp`, `recipient_id`, `pricing` (`billable`, `pricing_model`, `category`), `errors[]` (`code`, `title`, `error_data.details`).

- Actualizar `Message` y, si es de campaña, `CampaignRecipient` + contadores.
- Los estados solo avanzan; `failed` siempre gana.
- Guardar `pricing.category` y `billable` para el cálculo de coste.
- Puede llegar un estado **antes** de haber guardado el wamid de la respuesta del envío: dejar el evento sin procesar y reintentarlo (la cola lo hace con espera).

## Envío de mensajes

`POST /{GRAPH_API_VERSION}/{WA_PHONE_NUMBER_ID}/messages` con `Authorization: Bearer {token}`. La respuesta trae `messages[0].id` = wamid, que se guarda al momento.

```json
// Texto (opcionalmente como respuesta a otro mensaje)
{ "messaging_product": "whatsapp", "recipient_type": "individual", "to": "34617498222",
  "type": "text", "text": { "body": "Hola Ginés…", "preview_url": true },
  "context": { "message_id": "wamid.XXX" } }

// Documento ya subido a WhatsApp
{ "messaging_product": "whatsapp", "to": "34617498222", "type": "document",
  "document": { "id": "<media_id>", "filename": "DOUSSE Carta de Color.pdf", "caption": "Te envío la carta" } }

// Plantilla con cabecera de imagen, una variable y botón de baja
{ "messaging_product": "whatsapp", "to": "34617498222", "type": "template",
  "template": { "name": "campana_imagen", "language": { "code": "es" },
    "components": [
      { "type": "header", "parameters": [ { "type": "image", "image": { "id": "<media_id>" } } ] },
      { "type": "body",   "parameters": [ { "type": "text", "text": "Ginés" } ] },
      { "type": "button", "sub_type": "quick_reply", "index": "1",
        "parameters": [ { "type": "payload", "payload": "OPT_OUT" } ] } ] } }

// Marcar como leído (al abrir la conversación)
{ "messaging_product": "whatsapp", "status": "read", "message_id": "wamid.XXX" }
```

- Texto libre y adjuntos **solo con la ventana de 24 h abierta**. Si Meta devuelve 131047, la ventana estaba cerrada: marcar el mensaje como fallido y ofrecer plantilla.
- Notas de voz: enviar `audio` en OGG/Opus (convertido en el servidor).
- Reintentos solo para errores temporales (tabla de errores).

## Media

| Operación | Llamada |
| --- | --- |
| Subir | `POST /{WA_PHONE_NUMBER_ID}/media` (multipart: `file`, `type`, `messaging_product=whatsapp`) → `{ id }` |
| Obtener URL | `GET /{media_id}` → `{ url, mime_type, sha256, file_size }` |
| Descargar | `GET {url}` con el mismo `Authorization` → binario. **La URL caduca en minutos**: descargar en el worker en cuanto llega el webhook |

Los ids de media subidos caducan; guardar `waMediaIdExpiresAt` y volver a subir si hace falta. Validar tipo y tamaño máximo por tipo según la documentación vigente antes de enviar.

## Plantillas

| Operación | Llamada |
| --- | --- |
| Listar | `GET /{WA_WABA_ID}/message_templates?fields=id,name,status,category,language,components,quality_score,rejected_reason&limit=100` (paginar) |
| Crear | `POST /{WA_WABA_ID}/message_templates` con `name`, `language`, `category`, `components` |
| Borrar | `DELETE /{WA_WABA_ID}/message_templates?name=<nombre>` |

Reglas para el editor:

- `name` en minúsculas, números y `_`; único por idioma. El nombre legible va en `displayName`.
- Variables del cuerpo `{{1}}`, `{{2}}`… consecutivas y **con ejemplo obligatorio** (`example.body_text`).
- Cabecera con imagen, vídeo o documento: el ejemplo se sube antes con la **Resumable Upload API** (`POST /{META_APP_ID}/uploads` → sesión → subir el archivo → `handle`) y se envía en `example.header_handle`.
- Pie hasta 60 caracteres; botón de respuesta rápida hasta 25 caracteres; botón de enlace con URL fija o con una variable al final.
- Categoría: Meta puede **recategorizar** (p. ej. de Utilidad a Marketing); se refleja por webhook.
- Marketing nuevo: **botón de respuesta rápida «No recibir más» obligatorio** (payload `OPT_OUT` al enviar). La LSSI (art. 21) exige ofrecer la baja de forma sencilla y gratuita en cada comunicación comercial. Las plantillas de marketing sin ese botón no se pueden usar en campañas.
- Las 12 plantillas actuales son todas Marketing (incluidas «Buenos días», «Buenas Tardes» e «Inicio de Conversación», que sirven para reabrir chats): cada envío cuesta tarifa de marketing.

## Ventana de 24 h, límites y calidad

| Concepto | Regla (05/11/2026) | Qué hace la app |
| --- | --- | --- |
| Ventana de atención | 24 h desde el último mensaje del cliente | Cuenta atrás en la cabecera; compositor solo plantilla al cerrarse |
| Límite de mensajería | Usuarios únicos contactados **fuera de ventana** en 24 h móviles, **a nivel de portfolio** (escalones 250 / 2.000 / 10.000 / 100.000 / ilimitado). Hoy: 2.000 | Antes de lanzar o en cada tanda: contar destinatarios únicos con `sentOutsideWindow` en las últimas 24 h y no superar el límite; repartir el resto al día siguiente |
| Rendimiento | Muy por encima de lo que necesitamos (decenas de mensajes por segundo) | Ritmo propio de 20/min por defecto para cuidar la calidad |
| Límite por pareja | Demasiados mensajes seguidos a la misma persona → 131056 | Esperar y reintentar |
| Tope de marketing por usuario | Meta puede no entregar marketing a quien recibe demasiado → 131049 | No reintentar; motivo visible en el informe |
| Calidad | Verde / amarillo / rojo; puede marcar el número | Aviso inmediato (banner en la app) y parada de campañas si es roja o el número queda marcado |

Datos del número: `GET /{WA_PHONE_NUMBER_ID}?fields=…` (calidad, estado, nombre verificado y el campo de límite que corresponda ahora que es por portfolio; comprobar los nombres de campo vigentes). Consultar cada hora y guardar `QualitySnapshot`.

## Errores y qué hacer

| Código | Significado | Acción |
| --- | --- | --- |
| 130429 | Límite de rendimiento de la API | Reintentar con espera exponencial; bajar ritmo |
| 131026 | No entregable (no tiene WhatsApp, condiciones no aceptadas, versión antigua) | No reintentar; a la segunda vez marcar `phoneInvalid` |
| 131047 | Ventana de 24 h cerrada | No reintentar; ofrecer plantilla |
| 131049 | Meta no lo entrega para proteger la experiencia (tope de marketing) | No reintentar en la campaña |
| 131050 | El usuario ha parado los mensajes de marketing | No reintentar; `consentStatus = REVOKED` (origen META_ERROR_131050) |
| 131051 | Tipo de mensaje no soportado | Error de programación: registrar |
| 131056 | Límite por pareja empresa-usuario | Reintentar más tarde |
| 132000 / 132012 | Variables de plantilla mal (número o formato) | No reintentar; error en la campaña |
| 132001 | Plantilla inexistente o no aprobada en ese idioma | Parar campaña; resincronizar plantillas |
| 132015 | Plantilla pausada por baja calidad | **Parar la campaña** y avisar |
| 133010 | Número no registrado | Alerta crítica (no debería pasar) |
| 368 / 131031 | Cuenta restringida o bloqueada | **Parar todo envío**, banner crítico en la app y estado `critical` en `/api/status` (lo detecta la revisión diaria de Claude) |
| 5xx / red | Fallo temporal | Reintentar |

Mostrar siempre el motivo en español en la interfaz (traducción en `packages/shared`).

## Respuesta automática fuera de horario y vacaciones (MVP)

- **Encendida desde el primer día** (P3). Se envía al recibir un mensaje **fuera del horario** (o dentro del periodo de vacaciones, que empieza apagado) y solo si `lastAutoReplyAt` es de hace más de 12 h.
- Va **dentro de la ventana** que acaba de abrir el cliente, así que es un mensaje de servicio: **gratis hasta 1.000 al mes por número** (desde el 1/10/2026 Meta cobra los mensajes de servicio a partir del 1.001).
- Mensaje interactivo con hasta 3 botones de respuesta. Ojo: **el título de un botón interactivo admite 20 caracteres** (los de la plantilla actual tienen 22–25), así que se acortan: «Hacer un pedido», «Necesito factura», «Duda o consulta». Al pulsar uno, se etiqueta la conversación (PEDIDO / FACTURA) si el cliente lo confirma.
- Se guarda como `kind = AUTO_REPLY` y se ve en el historial.

## Costes (cálculo en la app)

- Desde el 1/7/2025 Meta cobra **por mensaje entregado** según categoría y país del destinatario.
- España, 05/11/2026 (EUR): marketing 0,0585 · utilidad 0,0166 · autenticación 0,0166 · servicio 0,0166 tras los 1.000 gratis al mes por número. Desde el 1/10/2026 también se cobran las plantillas de utilidad enviadas dentro de la ventana.
- La app calcula el coste real con `pricing.billable` y `pricing.category` de cada estado y las tarifas del ajuste `rates` (editables; moneda **EUR**, la de la cuenta de WhatsApp).
- Referencia del último mes: 1.394 marketing ≈ 82 € + IVA si aplica.

## Simulador de Meta para pruebas

Servidor de pruebas en el repo (`apps/api/test/meta-simulator`) que:

- Acepta `POST /messages`, `/media`, `/message_templates` y devuelve respuestas con la forma real.
- Genera webhooks firmados con el App Secret de pruebas: entrantes de todos los tipos, estados (incluidos `failed` con cada código de la tabla), cambios de plantilla y de calidad.
- Permite reproducir los casos límite: estado antes que la respuesta del envío, webhook duplicado, URL de media caducada, 130429 en ráfaga.

Ningún test automático llama a la Meta real. Las pruebas con Meta real se hacen a mano con el **número de prueba de Meta** antes de conectar el número del cliente.

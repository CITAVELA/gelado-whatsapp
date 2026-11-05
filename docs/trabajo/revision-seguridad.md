# Revisión de seguridad (S10 · commit d62b850)

Sin hallazgos críticos ni altos. 7 medios y 12 bajos. Bien: firma del webhook, permisos por endpoint (80 rutas = `ENDPOINTS` = docs/03), SQL parametrizado, saneado de `/privacidad`, neutralización de fórmulas en CSV, sin secretos en el historial, sin `/register`.

| Id | Grav. | Punto | Dueño | Archivo | Qué falla | Arreglo |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | medio | 3 CSRF | orquestador | `auth/guards.ts:25` | `startsWith('/api/')` distingue mayúsculas; `POST /API/contacts` sin cabecera → 201 | exigir la cabecera en todo método que cambie datos salvo `@SkipCsrf`, sin mirar prefijo |
| M2 | medio | 2 sesiones | orquestador | `realtime/realtime.gateway.ts` | sockets abiertos no se cortan al revocar/desactivar; `Origin` no validado | `disconnectSockets` al revocar (por usuario y por sesión), revalidar periódicamente, comprobar `Origin` contra `APP_URL` |
| M3 | medio | 1/10 | S1 | `webhooks.controller.ts`, `webhook-ingest.service.ts` | cada POST sin firma inserta una fila; cuerpo de 5 MB | no persistir rechazos (contador/log); límite 1 MB en `/webhooks` |
| M4 | medio | 10 | S11 | `jobs.service.ts` | `cron-daily-cleanup` sin handler: no hay limpieza de 90 días ni de sesiones/enlaces | handler diario: `WebhookEvent` procesados > 90 d, rechazados > 7 d, `Session` caducadas, tokens usados/caducados > 30 d |
| M5 | medio | 7/10 | S2 (+S1) | `contacts/import.parser.ts`, `media.controller.ts` | bomba zip XLSX (750 KB → OOM); `memoryStorage` 100 MB | comprobar tamaño descomprimido antes de ExcelJS (≤ 50 MB, ratio ≤ 100) o lector en streaming; tope de subidas simultáneas |
| M6 | medio | 10 RGPD | S2 | `contacts/contacts.service.ts:138` | la supresión física deja `MediaFile`, objetos de Storage y `WebhookEvent` con datos | borrar media y Storage (si no es de biblioteca) y borrar/anonimizar `WebhookEvent` con su `wa_id` |
| M7 | medio | 10 | S11 | `package.json` | dependencias con avisos: compression 1.8.0, multer 2.0.2, @nestjs/core 11.1.6, path-to-regexp, sanitize-html 2.17, react-router-dom 7.9.4 (redirección abierta) | actualizar; `LoginPage` acepta `from` solo si empieza por `/` y no por `//` |
| B1 | bajo | 2 | orquestador | `bootstrap.ts`, `auth.service.ts`, `rate-limit.ts` | IP falseable con `X-Forwarded-For` si hay más saltos; enumeración por tiempo; `Map` sin purga | argon2 contra hash señuelo; purgar claves; confirmar saltos en Render |
| B2 | bajo | 2 | orquestador | `auth.controller.ts` | la cookie no se renueva al deslizar la caducidad | reemitir la cookie al deslizar |
| B3 | bajo | 5 | orquestador | migración init | RLS solo en tablas de la init; `pgboss` sin RLS | prueba que vigile `rowsecurity`; RLS en `pgboss` tras arrancar |
| B4 | bajo | 7 | orquestador/S1 | `inbound-media.service.ts`, `storage.service.ts`, `config.ts` | MIME entrante sin lista blanca, servido en línea; producción admite `STORAGE_DRIVER=local` | lista blanca; `attachment` fuera de imagen/audio/vídeo; exigir supabase y `APP_URL` no local en producción |
| B5 | bajo | 7 | S1 | `media/audio-convert.ts` | ffmpeg detecta formato por contenido (HLS lee archivos locales) | forzar demuxer y `-protocol_whitelist file` o `pipe:0` |
| B6 | bajo | 6/7 | S1 | `whatsapp.gateway.ts:104` | token Bearer a cualquier URL de descarga; sin tope de tamaño | lista de hosts de Meta, `redirect:'error'`, tope ~100 MB |
| B7 | bajo | 4 | S6 | `campaigns.service.ts:110` | TOCTOU al editar borrador mientras se lanza | `updateMany where status DRAFT` + 409 |
| B8 | bajo | 9 | S6 | `campaigns.service.ts:339` | exportar con nombre «Łódź» → 500 (`ERR_INVALID_CHAR`) | `filename*=UTF-8''…` |
| B9 | bajo | 10 | S5/S6 | `library.service.ts` | subir/borrar biblioteca sin auditoría; campañas auditadas sin IP | `audit.log` con IP |
| B10 | bajo | 9 | S11 | `bootstrap.ts` | `/api/*` y exportaciones sin `Cache-Control` | `private, no-cache` en `/api`; `no-store` en exportaciones y auth |
| B11 | bajo | 9 | S11 | `bootstrap.ts:46` | `connect-src ws: wss:` a cualquier host | solo `'self'` |
| B12 | bajo | 6 | orquestador | `config.ts:62` | producción no rechaza `127.0.0.1`; `STATUS_TOKEN` sin longitud mínima | exigir `https://` y `STATUS_TOKEN` ≥ 32 |

Orden recomendado: M1, M2, M5, M4+M3, M6, M7; después los bajos.

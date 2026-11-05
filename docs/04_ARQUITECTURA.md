# 04 · Arquitectura

Una sola aplicación pequeña para 3 usuarios y unas 2.000 conversaciones al mes. Prioridades: simple de mantener, barata, y que **nunca pierda un mensaje** de WhatsApp.

## Vista general

```
WhatsApp (Meta Cloud API)
      │  webhook (POST firmado)            ▲ Graph API (envíos, plantillas, media)
      ▼                                     │
┌────────────────────── Render · 1 servicio web (Starter) ──────────────────────┐
│ NestJS                                                                         │
│  ├─ /webhooks/whatsapp  → guarda el evento crudo → encola → responde 200       │
│  ├─ /api/*              → API REST para la web (sesión por cookie)             │
│  ├─ /ws                 → WebSocket (socket.io) para tiempo real en la bandeja │
│  ├─ worker (pg-boss)    → procesa eventos, envíos, campañas, tareas periódicas │
│  └─ sirve la SPA        → React + Vite compilada (mismo dominio)               │
└───────────────┬───────────────────────────────────────┬───────────────────────┘
                │ Prisma / pg-boss                        │ Storage API (service role)
                ▼                                         ▼
        Supabase PostgreSQL (UE)                 Supabase Storage (bucket privado)
```

- **Un solo servicio** en Render: API, worker y web en el mismo proceso y el mismo dominio (sin CORS, cookies de primera parte). Si algún día pesa, el worker se separa con una variable de entorno (`WORKER_ENABLED`) sin cambiar código.
- **Cola en PostgreSQL con pg-boss**: sin Redis, un servicio menos que pagar.
- **Supabase se usa solo como PostgreSQL + Storage.** No se usa Supabase Auth ni su API de datos (ver seguridad).

## Repositorio

Monorepo con pnpm workspaces:

```
/apps/api        NestJS (API, webhook, worker, sirve la web)
/apps/web        React + Vite + TypeScript
/packages/shared Tipos, esquemas zod y constantes compartidas (estados, errores de Meta, tarifas)
/prisma          schema.prisma y migraciones
/docs            Este paquete de documentación
```

Reutilizar de CITAVELA lo que ya existe y funciona (cliente de la Graph API, verificación de firma del webhook, envío de plantillas), copiándolo, sin dependencia entre repos.

## Componentes del backend (módulos NestJS)

| Módulo | Responsabilidad |
| --- | --- |
| `auth` | Login, sesiones en BD (cookie httpOnly opaca), recuperación de contraseña, roles |
| `users` | Alta, baja, rol de usuarios |
| `whatsapp` | Cliente Graph API (envío de mensajes, media, plantillas, datos del número), verificación de firma, mapeo de errores |
| `webhooks` | Recepción, persistencia cruda, deduplicación, encolado |
| `inbox` | Conversaciones, mensajes, asignación, estados, etiquetas, notas, búsqueda, eventos |
| `contacts` | Contactos, etiquetas de contacto, consentimiento, importación/exportación |
| `templates` | Sincronización, creación, estados |
| `campaigns` | Audiencia, planificación, envío escalonado, informe |
| `media` | Subida/descarga a Storage, URLs firmadas, transcodificación de notas de voz |
| `library` | Biblioteca de archivos reutilizables |
| `quality` | Calidad del número, límites, alertas, costes |
| `settings` | Horario, fuera de horario, vacaciones, tarifas |
| `realtime` | Gateway socket.io: emite cambios de conversación/mensaje a los usuarios conectados |
| `jobs` | Registro de colas y tareas periódicas de pg-boss |
| `audit` | Registro de actividad |

## Colas y tareas (pg-boss)

| Cola / tarea | Qué hace | Reintentos |
| --- | --- | --- |
| `wa.inbound` | Procesa un evento de webhook (mensaje, estado, plantilla, calidad) | 5, con espera exponencial; idempotente por `wamid`/id de evento |
| `wa.media.download` | Descarga un adjunto entrante (la URL de Meta caduca en minutos) y lo guarda en Storage | 5 |
| `wa.send` | Envía un mensaje saliente del chat | 3; no reintentar errores definitivos |
| `campaign.dispatch` | Lanza los lotes de una campaña respetando ritmo y límite de 24 h | — |
| `campaign.send` | Envía a un destinatario | 3 para errores temporales (130429, 131056, 5xx) |
| Cada minuto | Reabrir conversaciones pospuestas vencidas; lanzar campañas programadas | — |
| Cada hora | Sincronizar plantillas y datos de calidad/límite del número | — |
| Cada día 03:00 | Limpieza de eventos de webhook procesados de más de 90 días | — |

## Consumo en Render

Render factura como tráfico de salida también las consultas del servicio a Supabase (Hobby: 5 GB/mes; exceso 0,15 USD/GB). Con pg-boss sondeando cada segundo salían ~30 GB/mes en reposo. **Objetivo: < 3 GB/mes en total y < 2 MB/h hacia la base de datos en reposo.**

- **Despertar en proceso.** Todos los trabajos nacen en este proceso (webhook, API, crons). `JobsService.send()` encola y despierta en el acto al worker de esa cola (`boss.notifyWorker`); al terminar un trabajo el worker vuelve a consultar una vez por si hay más. El sondeo queda solo como red de seguridad (reintentos con `startAfter`, trabajos que sobreviven a un reinicio). El mensaje entrante sigue siendo visible en < 5 s (en la práctica < 1 s).
- **Intervalos.** Sondeo: `wa-inbound` y `wa-send` 30 s; `wa-media-download`, `campaign-dispatch`, `campaign-send` y `contacts-import` 60 s. Mantenimiento interno de pg-boss (caducar/archivar/borrar) cada 30 min; monitor de estados y monitor de reloj apagados. Conexiones de pg-boss persistentes (`idleTimeoutMillis: 0`): sin ello cada sondeo abría una conexión TLS nueva.
- **Crons propios.** El planificador de pg-boss (`schedule`) está apagado. Un `setTimeout` alineado al minuto llama a los handlers de `cron-every-minute` (reencolar eventos atascados, lanzar/avanzar campañas, despertar pospuestas), `cron-hourly` (minuto :07, hora de Madrid) y `cron-daily-cleanup` (03:00). Lo pendiente vive en la BD, así que un reinicio no pierde nada; con una campaña en marcha el ritmo (20/min) sigue siendo exacto.
- **API y web.** Compresión gzip; `/assets/*` con huella `immutable` 1 año; `index.html` `no-cache`; ETag/304 en los GET que se refrescan (alertas 2 min, contadores 2 min, campañas 30 s) y sin sondeo con la pestaña oculta (`refetchIntervalInBackground: false`; el tiempo real va por socket).
- **render.yaml.** `buildFilter` ignora `docs/**`, `02-DOCS/**`, `01-TOOLS/**` y `**/*.md`; vistas previas apagadas.
- **Presupuesto.** `apps/api/test/s11-idle.test.ts` mide con un proxy TCP los bytes reales hacia/desde PostgreSQL durante 120 s en reposo y falla si superan 2 MB/h x 120/3600 x 0,7 (el 30 % restante es margen para TLS). Medición actual en el informe de S11 (≈ 0,5 MB/h y ≈ 13 consultas/min, unos 0,35 GB/mes; antes: ≈ 22 MB/h y 500 consultas/min).
- **Vigilarlo la primera semana.** Render → Metrics → tráfico de salida (Outbound Bandwidth) del servicio. Si de noche la curva no es plana (sin uso, debería rondar cero), hay un sondeo: revisar `pg_stat_statements` en Supabase (consultas más repetidas) y los intervalos de arriba. Objetivo del mes: < 3 GB.

## Tiempo real

- La web abre un WebSocket autenticado con la cookie de sesión.
- Eventos: `conversation.updated`, `message.created`, `message.status`, `badge.counts`, `alert`.
- Si el socket cae, la web vuelve a pedir el estado por REST al reconectar (nunca depender solo del socket).

## Archivos y media

- Bucket privado `media` en Supabase Storage. Ruta: `media/AAAA/MM/<uuid>.<ext>`.
- El navegador recibe **URLs firmadas** de corta duración (1 h); nunca la clave de servicio.
- Entrantes: el worker pide la URL a Meta y descarga **en cuanto llega el webhook** (caduca en minutos), guarda en Storage y enlaza el mensaje.
- Salientes: se sube a Storage → se sube a WhatsApp (`/media`) → se envía por id. El id de WhatsApp se guarda con su caducidad para reutilizarlo (biblioteca, cabeceras de campaña).
- Notas de voz: el navegador graba (webm/opus u ogg/opus según navegador); el servidor convierte a **OGG/Opus mono** con ffmpeg (`ffmpeg-static`) antes de enviar.
- Límites de tamaño por tipo según Meta (comprobar en la documentación vigente); validar antes de subir y avisar en la interfaz.

## Base de datos

- PostgreSQL de Supabase (región Frankfurt), plan Pro.
- Conexión desde Render por el **pooler de Supabase en modo sesión** (puerto 5432, IPv4), `connection_limit` bajo (5). Mismo pooler para Prisma, migraciones y pg-boss.
- Tablas en el esquema `app` (no `public`), ver seguridad.
- Modelo en `05_MODELO_DE_DATOS.md`.

## Seguridad

| Tema | Medida |
| --- | --- |
| Webhook | Verificar `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el App Secret) antes de nada; rechazar sin firma válida |
| Sesiones | Cookie httpOnly, Secure, SameSite=Lax, token opaco guardado con hash en BD; caducidad 30 días deslizante; cierre de sesión revoca |
| Contraseñas | argon2id; mínimo 10 caracteres; límite de intentos de login por IP y por usuario |
| CSRF | SameSite=Lax + cabecera obligatoria `X-Requested-With` en peticiones que cambian datos |
| Roles | Guard de NestJS por rol en cada endpoint (tabla de permisos en `03`) |
| Supabase | **Desactivar la Data API** del proyecto (o no exponer el esquema `app`) y activar RLS sin políticas en todas las tablas: así nadie puede leer datos con la clave pública. La clave `service_role` solo en el servidor |
| Secretos | Variables de entorno de Render: token de usuario de sistema de Meta, App Secret, verify token, URL de BD, claves de Supabase, token de `/api/status`. Nunca en el repositorio |
| Cabeceras | helmet con CSP estricta (la web se sirve desde el mismo origen) |
| Datos personales | Solo los necesarios; exportación y borrado de un contacto a petición (RGPD) |
| Auditoría | Tabla `AuditLog` para acciones sensibles |

## Entornos y despliegue

| Entorno | Dónde | Meta |
| --- | --- | --- |
| Local | Docker (PostgreSQL) + `apps/api` + `apps/web` en modo dev | **Simulador de Meta** propio (servidor fake que firma webhooks y acepta envíos) para pruebas sin coste; túnel (cloudflared) solo para probar con el número de prueba de Meta |
| Producción | Render (workspace del cliente, Hobby) + Supabase (organización del cliente, Pro) | App de Meta del cliente: primero con el **número de prueba de Meta**, luego con el número real |

- Despliegue automático de Render desde la rama `main`; migraciones de Prisma (`prisma migrate deploy`) en el comando de arranque.
- **CI mínimo**: sin GitHub Actions de pago; las pruebas las ejecuta el agente en local antes de cada entrega.
- `/health` para el health check de Render (comprueba BD).
- `/privacidad` es la única página pública además del login: HTML renderizado en el servidor desde el ajuste `privacy_policy` (Markdown saneado, sin HTML del usuario), sin sesión y con la misma CSP. Su URL completa (`https://<servicio>.onrender.com/privacidad`) y la de supresión (`…/privacidad#supresion`) se ponen en la configuración básica de la app de Meta (RF-7.6).
- Copias: diarias de Supabase Pro (7 días) + exportación mensual de contactos a CSV guardada en Storage.

## Cuentas y accesos

| Servicio | Titular y pago | Acceso de Julio |
| --- | --- | --- |
| Meta (Business Manager, app, WABA) | Cliente | Invitado al portfolio con acceso total |
| Render | Workspace del cliente, plan Hobby, tarjeta del cliente | Credenciales del cliente (Hobby no admite miembros) |
| Supabase | Organización del cliente, plan Pro, tarjeta del cliente | Miembro de la organización (se permiten miembros en todos los planes) o credenciales del cliente |
| GitHub | Repositorio privado `gelado-whatsapp` en la cuenta de Julio (J1) | Propietario |
| Dirección web | Sin dominio propio en el MVP: la dirección gratuita de Render (`*.onrender.com`) (P12) | — |
| Correo saliente | **No en el MVP** (P13): invitaciones y nuevas contraseñas por enlace generado en la app; avisos en la app | — |

## Rendimiento esperado

- Carga muy baja (decenas de mensajes por hora; campañas de ~1.500 destinatarios a 20/min ≈ 75 min).
- Render Starter (512 MB) es suficiente; vigilar la memoria en la conversión de notas de voz.

# gelado-whatsapp

Plataforma de WhatsApp de **Exclusivas Gelado**: bandeja compartida, contactos, plantillas y campañas sobre la **API oficial de Meta (Cloud API)**. Sustituye a Superchat.

- Documentación funcional: [`docs/00_LEEME.md`](docs/00_LEEME.md) · Maquetas: [`docs/maquetas/`](docs/maquetas/) · Contexto para Claude: [`CLAUDE.md`](CLAUDE.md)
- Repositorio privado de Julio. Alojamiento en las cuentas de Render y Supabase del cliente.

## Arrancar en local (5 comandos)

```bash
pnpm install
cp .env.example .env          # y pon SEED_DEV_PASSWORD=una-clave-larga (solo desarrollo)
pnpm db:up && pnpm db:deploy && pnpm db:seed
pnpm dev                      # web http://localhost:5173 · api :3000 · simulador de Meta :4010
pnpm test && pnpm build && pnpm test:e2e
```

Entra con `gelado.comercial@gmail.com` (administradora) o `administracion2@gelado.eu` (agente) y la contraseña de `SEED_DEV_PASSWORD`. Sin esa variable, el seed imprime los **enlaces de invitación** de un solo uso.

Para simular un cliente que escribe, con `pnpm dev` en marcha:

```bash
curl -s localhost:4010/_sim/inbound -H 'Content-Type: application/json' \
  -d '{"from":"34600111222","name":"Peluquería Marisol","type":"text","text":{"body":"Hola, ¿tenéis la carta de color de DOUSSE?"}}'
```

El simulador (`apps/api/test/meta-simulator`) firma los webhooks como Meta y acepta los envíos. **Nunca** se llama a la Meta real desde desarrollo ni desde las pruebas.

## Estructura

| Carpeta | Qué hay |
| --- | --- |
| `apps/api` | NestJS: API REST (`/api`), webhook (`/webhooks/whatsapp`), worker pg-boss, WebSocket (`/ws`), `/privacidad` y la web compilada. Prisma en `apps/api/prisma` |
| `apps/web` | React + Vite + TypeScript |
| `packages/shared` | Tipos, esquemas zod, errores de Meta, tarifas, utilidades de teléfono y horario |
| `e2e` | Playwright contra el build de producción y el simulador |
| `render.yaml` | Blueprint de Render (1 servicio web Starter en Frankfurt) |

## Producción (Render + Supabase del cliente)

### URLs para la app de Meta (configuración básica)

| Campo de Meta | URL |
| --- | --- |
| URL de la política de privacidad | `https://<servicio>.onrender.com/privacidad` |
| URL de instrucciones de eliminación de datos | `https://<servicio>.onrender.com/privacidad#supresion` |
| Webhook (URL de devolución de llamada) | `https://<servicio>.onrender.com/webhooks/whatsapp` (token de verificación = `WA_VERIFY_TOKEN`) |

Campos del webhook a suscribir: `messages`, `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `phone_number_quality_update`, `account_update`.

### Variables de entorno (Render → Environment; nunca en el repositorio)

| Variable | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<servicio>.onrender.com` (se usa en los enlaces de invitación) |
| `SESSION_SECRET`, `STATUS_TOKEN` | aleatorios (Render los genera con el Blueprint) |
| `DATABASE_URL`, `DIRECT_URL` | pooler de Supabase **en modo sesión** (puerto 5432, IPv4) + `?schema=app&connection_limit=5` |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | proyecto de Supabase; bucket privado `media` |
| `META_GRAPH_BASE_URL` | `https://graph.facebook.com` |
| `GRAPH_API_VERSION` | versión vigente de la Graph API al desplegar (p. ej. `v23.0`) |
| `META_APP_ID`, `META_APP_SECRET` | app de Meta del cliente |
| `WA_SYSTEM_USER_TOKEN` | token permanente del usuario de sistema (`whatsapp_business_messaging`, `whatsapp_business_management`) |
| `WA_VERIFY_TOKEN` | cadena aleatoria para verificar el webhook |
| `WA_WABA_ID`, `WA_PHONE_NUMBER_ID`, `META_BUSINESS_ID` | `24936790469294569`, `833139829886325`, `115003938195726` |
| `WORKER_ENABLED` | `true` (si un día se separa el worker, `false` en la web) |

La app **se niega a arrancar** en producción si falta algún secreto o si `META_GRAPH_BASE_URL` apunta al simulador.

### Despliegue

1. Supabase (Frankfurt, Pro): crear el proyecto, **desactivar la Data API** (o no exponer el esquema `app`), crear el esquema `app` y el bucket privado `media`. Las migraciones activan RLS sin políticas en todas las tablas.
2. Render: «New → Blueprint» con este repositorio (`render.yaml`), rellenar las variables marcadas `sync: false`. Despliega desde `main`; el arranque ejecuta `prisma migrate deploy`.
3. Primera vez: `pnpm db:seed` desde la Shell de Render (sin `SEED_DEV_PASSWORD`) → imprime los enlaces de invitación de María, Cristina y Lolo. También se generan después en Ajustes → Equipo.
4. Comprobar `https://<servicio>.onrender.com/health` y `/privacidad`.
5. Seguir `docs/09_MIGRACION_Y_PUESTA_EN_MARCHA.md` (D4 suscribir la app a la WABA, prueba real, modo Live). **No se llama nunca a `/register`**.

### Revisión diaria

`GET /api/status` con `Authorization: Bearer <STATUS_TOKEN>` → `{ status: ok|warning|critical, quality, alerts, … }`.

### Rotar el token de Meta

1. Business Manager del cliente → Usuarios del sistema → generar un token nuevo (mismos permisos, sin caducidad).
2. Render → Environment → sustituir `WA_SYSTEM_USER_TOKEN` → «Save, rebuild and deploy» (o «Save and deploy»).
3. Comprobar en Calidad que se actualizan los datos del número y enviar un mensaje de prueba. Después, revocar el token anterior.

Para el App Secret: Meta → app → Configuración básica → restablecer; actualizar `META_APP_SECRET` en Render a la vez (si no, los webhooks se rechazan con 401).

### Restaurar una copia

- Supabase Pro guarda copias diarias 7 días: Dashboard → Database → Backups → «Restore». Restaura el proyecto entero (base de datos); los archivos de Storage no se tocan.
- Para recuperar solo contactos: la exportación CSV (Contactos → Exportar) se puede volver a importar con el asistente (duplicados: «actualizar»).
- Tras restaurar, reiniciar el servicio de Render para que pg-boss retome las colas.

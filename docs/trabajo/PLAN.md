# Plan de trabajo del MVP (sesión autónoma)

Rama de integración: `claude/mvp`. `main` no se toca. Cada subagente trabaja en su worktree `.worktrees/<rama>` y su rama `claude/<rama>`; el orquestador integra.

## Contratos (Paso 0, ya publicados)

| Contrato | Dónde |
| --- | --- |
| Enums, DTOs y esquemas zod | `packages/shared/src/*` (un archivo por módulo) |
| Lista de endpoints REST con rol | `packages/shared/src/endpoints.ts` (`ENDPOINTS`) — la prueba de permisos la recorre |
| Eventos WebSocket | `packages/shared/src/ws.ts` |
| Errores de Meta (traducción y acción) | `packages/shared/src/meta-errors.ts` |
| Cliente Graph API | `apps/api/src/modules/whatsapp/whatsapp.gateway.ts` (`WhatsAppGateway`, sin `/register`) |
| Bus de eventos internos | `apps/api/src/modules/events/domain-events.service.ts` (`DomainEvents`) |
| Cambio de consentimiento | `apps/api/src/modules/contacts/consent.service.ts` (`ConsentService`, única puerta) |
| Ajustes | `apps/api/src/modules/settings/settings.service.ts` (`SettingsService`) |
| Mapeo Prisma → DTO | `apps/api/src/modules/inbox/mappers.ts` |
| Colas pg-boss | `apps/api/src/modules/jobs/jobs.service.ts` (`QUEUES`, `register`, `send`; inline en pruebas) |
| Storage (forma Supabase) | `apps/api/src/modules/storage/storage.service.ts` |
| Tiempo real | `apps/api/src/modules/realtime/realtime.gateway.ts` (`RealtimeService.emit`) |
| Simulador de Meta | `apps/api/test/meta-simulator/simulator.ts` |
| Utilidades de prueba | `apps/api/test/utils/app.ts` |
| Web: cliente API, auth, socket, UI común | `apps/web/src/lib/*`, `apps/web/src/components/*`, `apps/web/src/layout/*` |

## Propiedad de archivos (para no pisarse)

| Subagente | Backend | Web | Shared |
| --- | --- | --- | --- |
| S1 · WhatsApp núcleo | `modules/whatsapp/**`, `modules/webhooks/**`, `modules/media/**`, `test/meta-simulator/**` | — | `whatsapp.ts`, `meta-errors.ts`, `library.ts` (límites) |
| S2 · Contactos | `modules/contacts/**`, `modules/labels/**` | `features/contacts/**` | `contacts.ts`, `labels.ts`, `phone.ts` |
| S3 · Plantillas | `modules/templates/**` | `features/templates/**` | `templates.ts` |
| S4 · UI bandeja y base | — | `features/inbox/**`, `components/**`, `layout/**`, `styles/app.css` | — |
| S5 · Bandeja backend | `modules/inbox/**`, `modules/library/**` | conecta `features/inbox/**` | `inbox.ts` |
| S6 · Campañas | `modules/campaigns/**` | `features/campaigns/**` | `campaigns.ts` |
| S7 · Calidad, costes, ajustes | `modules/quality/**`, `modules/settings/**` | `features/quality/**`, `features/settings/**` | `quality.ts`, `settings.ts`, `costs.ts` |
| Orquestador | `app.module.ts`, `bootstrap.ts`, `common/**`, `auth`, `users`, `audit`, `jobs`, `events`, `prisma/**` | `App.tsx`, `lib/**` | `index.ts`, `enums.ts`, `endpoints.ts`, `ws.ts` |

Cambios fuera de lo propio (p. ej. `schema.prisma`, `endpoints.ts`): mínimos, explicados en el informe del subagente; el orquestador los integra.

## Estado

- [x] Paso 0 · base y contratos
- [x] Paso 1 · S1, S2, S3, S4 (integrados)
- [x] Paso 2 · S5, S6, S7 (integrados)
- [x] Paso 2b · S11 · Consumo en Render (añadido al encargo el 05/11/2026): pg-boss sin sondeo rápido (despertar en proceso al encolar; 30 s en wa-inbound/wa-send, 60 s el resto; intervalos internos largos), compresión, caché de assets e index, ETag/304, sin sondeo en pestaña oculta, buildFilter y sin vistas previas en render.yaml, prueba de reposo 120 s con presupuesto de consultas (< 2 MB/h hacia la BD; < 3 GB/mes en total), sección «Consumo en Render» en docs/04. Dueño de `modules/jobs`, `bootstrap.ts` y `render.yaml`; revisa el orquestador
- [ ] Paso 3 · S8 (QA), S9 (código), S10 (seguridad)
- [ ] Paso 4 · correcciones
- [ ] Paso 5 · verificación final

## Medición de consumo (orquestador)

| Momento | Método | Salida app→BD | Entrada BD→app | Estimación |
| --- | --- | --- | --- | --- |
| Antes de S11 (05/11/2026, `claude/mvp` con el paso 2 integrado) | Build de producción en reposo 120 s, workers activos, proxy TCP que cuenta bytes | 632 KB / 120 s ≈ 19 MB/h | 140 KB / 120 s ≈ 4,2 MB/h | ≈ 14 GB/mes de salida solo en reposo |
| Después de S11 (`claude/mvp` e26f581) | Mismo método, 120 s | 12,7 KB / 120 s ≈ 0,38 MB/h | 3,9 KB / 120 s ≈ 0,12 MB/h | ≈ 0,4 GB/mes en reposo (objetivo < 2 MB/h y < 3 GB/mes: cumplido) |

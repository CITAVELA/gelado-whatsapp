# Revisión de código independiente (S9 · commit d62b850)

1 crítico · 2 altos · 10 medios · 10 bajos. Pruebas de confirmación (reproducen el defecto) en el worktree de revisión: `tmp-s9-findings.test.ts` (H1, H1b, H2, H3, H4, H5, H6), `tmp-s9-import-race.test.ts` (H7), `tmp-s9-quality-stop.test.ts` (H9, H10).

| # | Grav. | Dueño | Archivo | Qué falla | Arreglo |
| --- | --- | --- | --- | --- | --- |
| 1 | **crítico** | S3 | `shared/templates.ts:82,170,214`; `messaging.service.ts:373`; `templates.service.ts:269` | detector del botón de baja por subcadena (`baja|stop`): «Ver rebajas» cuenta como baja → plantilla de marketing sin «No recibir más», usable en campañas, y quien pulsa «Ver rebajas» queda REVOKED | texto exacto normalizado «No recibir más» en editor, sincronización, duplicar y `optOutButtonIndex`; recalcular `hasOptOutButton` |
| 2 | alto | S1 | `messaging.service.ts:293-317, 204-219` | REVOKED solo se comprueba al encolar: el reintento de `wa-send` y `retry()` envían marketing a dados de baja; `retry` no mira campaña/plantilla/paradas | recomprobar en `processSend` justo antes de Graph; `retry` con las reglas de `sendTemplate` y campaña RUNNING |
| 7 | alto | S2 | `ImportWizard.tsx:163,52`; `shared/contacts.ts:116` | P7 se puede desactivar: NO PUBLICIDAD importado como UNKNOWN | el servidor incluye siempre NO PUBLICIDAD como baja; quitar la casilla; auditar opciones |
| 3 | medio | S1 | `webhook-ingest.service.ts:112` | dedupe de campos no-`messages` sin `entry.time`: FLAGGED→UNFLAGGED→FLAGGED o PAUSED repetido se descartan | incluir `entry.time`/id del cambio en la clave |
| 4 | medio | S1 | `messaging.service.ts:298-306`, `whatsapp.gateway.ts:63` | doble envío si Meta aceptó pero no se guardó el wamid (timeout, caída) | `biz_opaque_callback_data`; marcar en curso; no reenviar campañas con estado incierto |
| 5 | medio | S1 | `messaging.service.ts:287` | mensajes PENDING huérfanos para siempre | cron de cada minuto que reencola PENDING antiguos |
| 8 | medio | S2 | `import.service.ts:188,258` | carrera importación/entrante: P2002 → fila perdida (baja NO PUBLICIDAD perdida) | en P2002 releer por teléfono y actualizar (incl. REVOKED) |
| 9 | medio | S2 | `contacts.service.ts:141` | supresión física incompleta (media, Storage, WebhookEvent, archivo de importación); el número puede volver como UNKNOWN | borrar media y WebhookEvent; lista de supresión (hash del teléfono) que fuerza REVOKED |
| 11 | medio | S6/S7 | `campaign-runner.service.ts:91,201,165`; `quality.service.ts:105` | paradas con huecos: FLAGGED no pausa; programadas y `resume` no miran calidad roja/FLAGGED/cuenta; `account_update` no para | consultar estado bloqueante en `tick`, `start`, `resume`; parar con FLAGGED y restricciones |
| 12 | medio | S6 | `campaign-runner.service.ts:228,175` | SENDING huérfanos si el proceso muere entre claim y send: la campaña no termina | en el tick devolver a QUEUED los SENDING antiguos sin mensaje |
| 16 | medio | S11 | `jobs.service.ts:195` | no hay limpieza diaria (= S10 M4) | handler diario |
| 18 | medio | S5/orq. | `inbox.service.ts:201`, `storage.service.ts:97`, `library.service.ts:234` | N+1 de firmas de Storage (30 adjuntos → 30 POST secuenciales) | firma en lote + caché de URL ~50 min |
| 19 | medio | S4 | `useInboxRealtime.ts:17,45,68`; `messaging.service.ts:285` | cada envío de campaña invalida las listas en cada pestaña (también oculta): miles de peticiones por campaña | no invalidar en pestaña oculta; agrupar 3–5 s o parchear caché; no emitir `conversation.updated` por cada envío de campaña |
| 21 | medio | orq. | `schema.prisma` | faltan índices: `CampaignRecipient(contactId, sentAt)`, `WebhookEvent(receivedAt)`, `Message(createdAt)` parcial `sentOutsideWindow` | migración con índices |
| 6 | bajo | S1 | `messaging.service.ts:207`, `message-status.service.ts:49` | 5xx con código desconocido → sin «Reintentar» | guardar si era reintentable |
| 10 | bajo | S2 | `consent.service.ts:86` | CONSENT_CHANGED no se emite por WebSocket | emitir `event.created` y `conversation.updated` |
| 13 | bajo | S6/S7 | `campaigns.service.ts:258`, `quality.service.ts:236` | coste del informe ≠ coste del mes (filtro de estado distinto) | mismo filtro |
| 14 | bajo | S6 | `campaigns.service.ts:110` | TOCTOU al editar borrador (= S10 B7) | `updateMany where DRAFT` + 409 |
| 15 | bajo | S6 | `campaign-runner.service.ts:270` | cancelada sigue mostrando pendientes | al cancelar, SKIPPED «CANCELLED» |
| 17 | bajo | S11 | `jobs.service.ts:244,170` | `failedLast24h` no mira el archivo; tick largo se salta crons | unir `pgboss.archive`; ejecutar crons vencidos |
| 20 | bajo | S1 | `inbound-messages.service.ts:189` | carrera posponer/finalizar con entrante: queda escondida con no leído | reapertura condicional o `FOR UPDATE` |
| 22 | bajo | orq. | `realtime.gateway.ts` | socket no se corta al desactivar (= S10 M2) | desconectar sala |
| 23 | bajo | orq. | `domain-events.service.ts:39` | errores de handlers tragados: informe de campaña se desvía | propagar en `message.status` o resincronizar en `recompute` |

Comprobado sin defectos: estados que solo avanzan, wamid único, reserva atómica de `lastAutoReplyAt`, reparto 2.500/2.000, `claim` con SKIP LOCKED, prueba/duplicar/reanudar frente a REVOKED, roles vs `ENDPOINTS`, índice FTS, DTO bandeja servidor↔web.

# Informe final · MVP Plataforma WhatsApp de Exclusivas Gelado

Rama `claude/mvp` (commit de verificación `e94c2ba` y siguientes, solo documentación). `main` intacta: la integración es por pull request tras aprobar esta entrega.

## 1. Qué está hecho (por módulo, con RF de `03`)

| Módulo | RF | Estado |
| --- | --- | --- |
| M1 Acceso | 1.1, 1.2, 1.3, 1.5 | Login con cookie httpOnly, invitación y nueva contraseña por enlace de un solo uso (sin correo), roles, desactivar, registro de actividad. 1.4 (2FA) es F2 |
| M2 Bandeja | 2.1–2.22 | Tres columnas como las maquetas; vistas con contadores y por etiqueta; ventana de 24 h con cuenta atrás; texto, adjuntos (foto, PDF, audio, vídeo, nota de voz OGG/Opus), todos los tipos entrantes; plantilla desde el chat; biblioteca; asignar (y automático al responder), etiquetas, posponer con atajos, finalizar/reabrir, estrella, no leído, notas internas, búsqueda (nombre, teléfono, texto), tiempo real, notificaciones y sonido, ficha lateral, marcar leído en WhatsApp. Móvil en una columna |
| M3 Contactos | 3.1–3.8 | Listado con filtros, ficha, importador CSV/XLSX con normalización E.164 e informe, exportación (admin), etiquetas, consentimiento con historial, bajas automáticas (botón, palabra clave, 131050, NO PUBLICIDAD), borrado lógico y físico con lista de supresión. **P16**: contactos sin móvil («Sin WhatsApp») |
| M4 Plantillas | 4.1–4.5, 4.7 (duplicar/borrar) | Sincronización (y cada hora), editor con vista previa, envío a revisión con Resumable Upload, estados por webhook, «No recibir más» obligatorio en marketing; las de marketing sin botón quedan «Sin botón de baja». Editar aprobadas es F2 |
| M5 Campañas | 5.1–5.10 | Asistente de una página, audiencia con exclusiones y recuento en vivo, prueba, programación, envío escalonado con límite de 24 h y reparto en días, pausar/reanudar/cancelar, paradas automáticas, informe con embudo, motivos y coste, exportación, duplicar |
| M6 Calidad y costes | 6.1–6.4 | Semáforo, límite y uso de 24 h, histórico, alertas (banner y `/api/status` con token), coste mensual desde `pricing`, comparativa de campañas |
| M7 Ajustes | 7.1–7.4, 7.6 | Horario, fuera de horario **encendido** (P3), vacaciones **apagado**, equipo con enlaces, etiquetas, biblioteca, tarifas EUR, registro de actividad, `/privacidad` SSR con `#supresion` y su editor |

## 2. Pruebas y cobertura

Verificación final sobre `e94c2ba` (BD recreada desde cero en cada suite):

| Suite | Resultado |
| --- | --- |
| API (Vitest + Supertest, contra el simulador de Meta y PostgreSQL local) | **875 / 875** en 37 ficheros |
| Web (Vitest + Testing Library) | **95 / 95** |
| Shared | **4 / 4** |
| e2e (Playwright contra el build de producción y el simulador) | **29 / 29** |
| Build de producción | correcto |
| Migraciones desde cero + seed + arranque con los comandos de `render.yaml` en modo producción | correcto (`/health`, `/privacidad`, SPA, `/api/status`, worker activo) |

Las 10 áreas de `08` están cubiertas (matriz punto → prueba en `docs/trabajo/QA.md`, apartado 2): webhook, entrantes de todos los tipos, media, ventana 24 h, bajas, campañas (incluida la de 2.500 con límite 2.000 que se reparte en 2 días y cuadra al 100 %), importación (7.000 filas en ~1,5 s), permisos (cada endpoint de admin da 403 a un agente), fuera de horario (con cambio de hora) y coste. Criterio de aceptación de 5 s: el entrante aparece en ~0,4–0,9 s sin recargar. Recorridos manuales con capturas: `docs/trabajo/capturas/recorridos/agente/` (21) y `.../admin/` (34).

## 3. Revisiones y cómo quedaron

- **Código (S9, Opus xhigh):** 1 crítico, 2 altos, 10 medios, 10 bajos → corregidos (detalle en `docs/trabajo/revision-codigo.md`). El crítico: el botón de baja se detectaba por subcadena («Ver rebajas» daba de baja). Re-revisión (Opus high): 10 defectos nuevos (5 medios, 5 bajos), todos corregidos con prueba (N1–N10).
- **Seguridad (S10, Opus high):** 0 críticos, 0 altos, 7 medios, 12 bajos (`docs/trabajo/revision-seguridad.md`) → corregidos salvo los indicados en el punto 5.
- **QA (S8):** F-1…F-21 corregidos; queda F-17 (rellenar los datos de la política de privacidad, tarea del cliente).

## 4. Decisiones tomadas por defecto

| Decisión | Pregunta de `10` |
| --- | --- |
| Usuarios del seed sin contraseña: enlaces de invitación de 7 días; nueva contraseña 24 h | P13 |
| Botones de fuera de horario etiquetan la conversación directamente (PEDIDO/FACTURA) | P3 |
| Teléfonos inválidos del importador: sin móvil se importan «Sin WhatsApp» si hay correo o código; sin nada, se descartan con motivo | P16 |
| Textos de baja aceptados: «No recibir más», «No recibir más publicidad», «Darme de baja» (exactos); «Baja»/«Stop» a secas no cuentan | P6, regla 5 |
| NO PUBLICIDAD siempre como baja (no se puede desmarcar al importar) | P7 |
| Lista de supresión (hash del teléfono con sal propia) tras el borrado físico: si el número vuelve, nace dado de baja | P11 |
| Campaña programada que llega a su hora con un bloqueo (calidad roja, cuenta restringida) pasa a Pausada; la administradora puede marcar una alerta como resuelta | P1 (lo más seguro) |
| Mensajes del chat con estado de envío incierto se reenvían; los de campaña no (FAILED «estado desconocido») | — |
| Prisma 6 (con URL en el schema), NestJS 11, Vite 7: versiones estables conocidas; Prisma en `apps/api/prisma` | — |
| «+» + 9 dígitos que empiezan por 6–9 y son válidos en España → +34 (corrección de Superchat) | P16 |

## 5. Pendiente o no hecho, con motivo

- «Guardar borrador» en el editor de plantillas (existe el estado `LOCAL_DRAFT`, no el botón): menor, no estaba en los RF.
- Errores de handlers internos (p. ej. seguimiento de campaña) se registran y no se reintentan (S9 #23, bajo): el informe se recalcula desde `CampaignRecipient`.
- Límite de subidas simultáneas en memoria (S10 M5 parcial) y confirmación de los saltos de proxy de Render para el límite de login por IP (S10 B1): revisar en Render la primera semana.
- `pnpm audit --prod`: quedan 3 avisos (zod 3 → exige zod 4, cambio mayor; `deepmerge-ts` solo en la CLI de Prisma; `uuid` dentro de exceljs).
- No probado (por regla o por entorno): Meta real, Supabase y Render reales, Safari/iOS/Firefox, micrófono real; la duración de la nota de voz sale 0:00 con el almacenamiento local.
- Un número real de Nueva Caledonia escrito «+687xxxxxx» se tomaría por español (improbable para este cliente).

## 6. Consumo en Render (añadido al encargo)

| | Salida app→BD en reposo | Estimación mensual en reposo |
| --- | --- | --- |
| Antes (sondeo de pg-boss cada 1 s, 8 colas) | ≈ 19–22 MB/h, ~500 consultas/min | ≈ 14–16 GB/mes (el cliente observó ~30 GB en Render con TLS) |
| Después (S11: despertar en proceso, sondeo 30/60 s, crons propios, conexiones persistentes) | **≈ 0,38–0,48 MB/h**, ~14 consultas/min | **≈ 0,3–0,4 GB/mes** |

Objetivos: < 2 MB/h en reposo y < 3 GB/mes en total. Con compresión, caché de un año para los recursos con huella, ETag/304 y sin sondeo en pestañas ocultas, el uso normal (3 usuarios, campañas semanales) debería quedar muy por debajo de 3 GB/mes. Vigilarlo la primera semana: Render → Metrics → tráfico de salida; si es plano de noche, es sondeo (`docs/04`, «Consumo en Render»). Prueba automática `test/s11-idle.test.ts`.

## 7. Importación de Superchat (añadido al encargo, P16)

- `Contact.phoneE164` opcional (un contacto tiene teléfono, correo o código; restricción en BD). Regla 1 de `05`: «si hay teléfono, E.164 y único».
- Teléfonos: «+6XXXXXXXX» → +34; «+6XXXXXXX» → incompleto; avisos «País distinto de España: revisar» y «Fijo español: probablemente sin WhatsApp»; fijos en notación científica → dígitos.
- Mapeo automático de las cabeceras de Superchat; ID, Género, fechas y campañas se ignoran (P9). TRANSPORTE también como etiqueta de contacto. Deduplicación teléfono → correo → código.
- Fixture sintético de 6.560 filas (`apps/api/test/fixtures/superchat-export-sintetico.csv`, datos inventados, generador reproducible): **6.560 contactos, 6.253 con WhatsApp, 307 sin WhatsApp, 3 bajas, 0 duplicados**; ~1,3 s. Las tres listas posteriores añaden su etiqueta sin quitar otras, sin duplicar y respetando las bajas.
- Sin teléfono no hay conversación («Abrir conversación» deshabilitado) y en campañas se excluyen siempre («x sin WhatsApp», motivo `NO_PHONE`).
- El CSV real **nunca** entra en el repositorio (`.gitignore` bloquea `*.csv`/`*.xlsx` salvo los fixtures `*-sintetico`).

## 8. Lo que necesita Julio o el cliente para desplegar

Variables a rellenar en Render (el resto las fija `render.yaml`): `APP_URL`, `DATABASE_URL` y `DIRECT_URL` (pooler de Supabase en modo sesión, `?schema=app&connection_limit=5`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_ID`, `META_APP_SECRET`, `WA_SYSTEM_USER_TOKEN`, `WA_VERIFY_TOKEN`. Pasos de `09`: B1–B4 (cuentas Supabase Pro y Render Hobby con tarjeta del cliente), C1–C3 (app de Meta, usuario de sistema y token), D1–D11 en orden (importación según D2, suscribir la app a la WABA, prueba real, rellenar `[CIF]`, `[domicilio social]`… en Ajustes → Privacidad, modo Live, tarjeta del cliente en Meta antes de retirar a Superchat). Detalle en `README.md`.

## 9. Arrancar y probar en local en 5 comandos

```bash
pnpm install
cp .env.example .env                                   # y poner SEED_DEV_PASSWORD=una-clave-larga
pnpm db:up && pnpm db:deploy && pnpm db:seed
pnpm dev                                               # http://localhost:5173 · simulador de Meta en :4010
pnpm test && pnpm build && pnpm test:e2e
```

# Informe · Endurecimiento posterior al MVP

Antes de la prueba real del 06/11/2026 a las 09:00. Rama `claude/post-mvp` (creada desde `claude/mvp`). `main` y el PR #1 sin tocar.

Subagentes: A · navegadores y móvil y B · borrador de plantillas (Sonnet 5.5 · high, cada uno en su worktree con su BD y sus puertos); revisión independiente del diff completo (Opus 5.5 · high); correcciones de los dueños; verificación final del orquestador.

## 1. Qué se ha hecho

### A · Navegadores y móvil

- **e2e en 5 proyectos**: Chromium, Firefox, WebKit (motor de Safari), Pixel 7 (Chromium móvil) e iPhone 14 (WebKit móvil). `pnpm test:e2e` los recorre uno a uno con la BD recién preparada (`e2e/scripts/run-projects.mjs`); `--project=…` para uno solo (ver «Comandos» en `CLAUDE.md`).
- **Fallos reales de la app, arreglados**:
  1. Móvil: mantener pulsado el micrófono no enviaba la nota al soltar (el botón se sustituye por la barra «Grabando» y no recibía el `pointerup`).
  2. iPhone y pantallas táctiles: los submenús de «Más acciones» (Asignar, Etiqueta, Posponer) se abrían y cerraban en el mismo toque.
  3. Móvil: el menú con submenú se salía de la pantalla.
  4. Safari: el pitido de aviso no sonaba (el `AudioContext` nace suspendido si no hay un gesto previo).
- **Notas de voz**: el navegador elige un formato que admite (Chrome webm/opus, Firefox ogg/opus, Safari e iOS mp4/AAC) y sube un MIME limpio con extensión coherente. El servidor acepta los tres, reconoce el contenedor por los bytes (no solo por el MIME declarado) y convierte siempre a OGG/Opus mono 48 kHz. Fixtures reales de cada formato en `apps/api/test/fixtures/audio/` (con su script de generación) y pruebas de conversión y de envío completo contra el simulador.
- **Notificaciones y sonido en Safari**: el permiso se pide solo con un clic (también en el Safari antiguo, con callback); el sonido se desbloquea en el primer gesto del usuario. En iPhone y iPad Safari no ofrece notificaciones a una web sin Service Worker: la bandeja lo dice con un aviso que se puede cerrar y el sonido sigue funcionando.

### B · «Guardar borrador» en plantillas (solo admin)

- Botón «Guardar borrador» en el editor (estado `LOCAL_DRAFT`, sin llamar a Meta; basta nombre e idioma). Desde el listado (filtro «Borrador») se reabre, se edita y se envía a revisión con la misma validación y el mismo envío que una plantilla nueva (botón «No recibir más» en Marketing, ejemplos, cabecera con Resumable Upload). Si Meta falla, sigue siendo borrador. «Duplicar» también se puede guardar como borrador.
- Endpoints admin: `POST /api/templates/draft`, `PUT /api/templates/:id/draft`, `POST /api/templates/:id/submit` (en `ENDPOINTS`; la prueba de permisos exige 403 a un agente).
- Los agentes no ven borradores (listado ni detalle), y no se pueden usar en el chat ni en campañas.
- Migración `20261105224600_plantilla_borrador_local`: columnas `Template.draftData` (contenido del editor) y `Template.submittingAt` (reserva mientras se envía; caduca a los 2 min). Se aplica sola al arrancar en Render (`pnpm db:deploy && pnpm start`).
- Borrar un borrador lo elimina del todo (nunca existió en Meta) y libera el nombre. Auditoría: `save_template_draft`, `submit_template_draft`, `adopt_template_draft`.

## 2. Revisión independiente y cómo quedó

| Id | Sev. | Hallazgo | Estado |
| --- | --- | --- | --- |
| R-1 | Alto | Móvil: si el permiso del micrófono tardaba, al concederlo se paraba la grabación al instante y se enviaba una nota vacía | Corregido: el tiempo se mide al soltar; sin grabación en marcha queda la barra; notas de < 1 s no se envían. Prueba unitaria y e2e móvil con permiso lento |
| R-2 | Medio | Un webhook de estado podía «aprobar» un borrador con su contenido local y no con el de Meta (y dejarlo usable en campañas sin botón de baja real) | Corregido: un borrador nunca se actualiza por webhook; se resincroniza con Meta. Pruebas de los dos escenarios |
| R-3 | Medio | Carreras al enviar un borrador (doble envío, borrar durante el envío, sincronización a la vez) | Corregido: reserva `submittingAt` antes de llamar a Meta; borrado condicionado; 409 en español. Pruebas concurrentes |
| R-10 | Medio | El aviso de iOS prometía notificaciones «añadiendo la web a la pantalla de inicio» (sin Service Worker no las hay) | Corregido (texto y `docs/04`) |
| R-4…R-9, R-11 | Bajo | Aviso y auditoría al adoptar un borrador; parpadeo tras enviar; filtro «Borrador» visible a agentes; migración con fecha futura; submenú que no se plegaba con ratón; comprobaciones débiles en el e2e 06; e2e 06 frágil en iPhone | Corregidos |

Además, en la verificación final (orquestador):

- Borrar un borrador que otra pestaña acaba de enviar ya no lo borra en Meta (irreversible): da 409 para que la admin lo decida desde el listado. Tiene prueba.
- La prueba «separadores de fecha» fallaba entre las 00:00 y las 03:00 por depender de la hora. Era un defecto de la prueba, no de la app, y queda corregida.
- `pnpm test` ya no lanza el e2e, como dice `CLAUDE.md`.

## 3. Resultados (código final, 06/11 madrugada)

| Suite | Resultado |
| --- | --- |
| Typecheck (shared, api, web) | correcto |
| Shared | 4 / 4 |
| API (Vitest + Supertest, simulador y PostgreSQL local) | 938 / 938 en 39 ficheros (antes 875) |
| Web (Vitest + Testing Library) | 145 / 145 en 20 ficheros (antes 95) |
| Build de producción | correcto |
| e2e chromium | 34 pasan · 1 saltada |
| e2e firefox | 33 pasan · 2 saltadas |
| e2e webkit | 34 pasan · 1 saltada |
| e2e pixel-7 | 34 pasan · 1 saltada |
| e2e iphone-14 | 34 pasan · 1 saltada |

Saltadas, con motivo:

- **F-11** (tabla «Equipo» a 1440 px) en móvil: es de escritorio.
- **Pitidos en Firefox:** el contenedor no tiene dispositivo de audio. La lógica del sonido está cubierta por pruebas unitarias.
- **Mantener pulsado el micrófono con permiso lento** en escritorio: es solo de móvil.

## 4. Pendiente o no comprobado

- **Prueba intermitente del MVP:** «5 mensajes de un número nuevo llegando a la vez» (`qa-reglas`) falló 1 vez en 3 pasadas completas de la API, con la máquina cargada. No volvió a fallar en 8 repeticiones aisladas ni en la pasada final. No se guardó el detalle del fallo.
  - Contacto, conversación y mensaje se crean en una sola transacción, con reintento.
  - En producción el mensaje va por una cola que reintenta a los 5 s.
  - Conviene repetirla capturando el error para ver si lo que se pasa es la espera de 4 s de la prueba.
- **Safari e iOS reales:** el WebKit de Playwright para Linux no trae `MediaRecorder`. En WebKit e iPhone la grabación se simula con una grabación real de Safari (mp4). Eso prueba la subida y la conversión, pero no el códec del Safari de verdad.
  - Mañana conviene grabar una nota real desde un iPhone y desde un Mac con Safari.
  - También conviene probar el micrófono real y el toque real en los submenús.
- **Notificaciones del sistema en iPhone:** no las hay. Requieren Web Push con Service Worker, que no está en el MVP. El sonido sí funciona con la bandeja abierta.
- **Borradores:**
  - Si dos personas editan el mismo borrador a la vez, gana el último guardado.
  - Si Meta falla al enviar, lo escrito se conserva en el editor, pero no se guarda solo: hay que pulsar «Guardar borrador».
- **Lista de conversaciones:** un entrante nuevo tarda unos 4–4,5 s en aparecer, por la ventana de refresco por lotes. Cumple el criterio de 5 s, con poco margen si la máquina va cargada.

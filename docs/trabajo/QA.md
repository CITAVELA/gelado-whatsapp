# QA del MVP (S8)

Informe de cobertura y de fallos. Rama `claude/s8-qa` (desde `claude/mvp`). Todo se ha ejecutado contra el simulador de Meta y PostgreSQL local; no se ha tocado Meta, Render ni Supabase reales y no se ha llamado nunca a `/register`. No se ha corregido código de producción: cada fallo está demostrado con una prueba marcada `it.fails` / `test.fail` (la suite sigue en verde y, cuando alguien lo arregle, la prueba avisa de que ya sobra la marca).

## 1. Resultado de las suites

| Suite | Comando | Resultado |
| --- | --- | --- |
| api (Vitest + Supertest, app Nest real, BD `gelado_test_s8`) | `cd apps/api && TEST_DATABASE_URL=…/gelado_test_s8?schema=app npx vitest run` | **21 ficheros, 694 pruebas, todas en verde** (557 s). 430 son nuevas (`qa-*`: 307 permisos, 32 reglas, 29 cobertura, 62 robustez); 11 de ellas son fallos documentados con `it.fails` |
| web (Vitest + Testing Library) | `pnpm -F @gelado/web test` | **9 ficheros, 62 pruebas, todas en verde** (18 nuevas en `qa-formato`, 1 con `it.fails`) |
| e2e (Playwright 1.63, Chromium, contra el build y el simulador) | `pnpm build` y `pnpm test:e2e` | **26 pruebas en verde** en 57 s: 21 comprobaciones y 5 defectos de interfaz documentados con `test.fail` (Playwright las cuenta como superadas mientras el defecto exista) |
| Recorridos manuales con capturas | `pnpm -F @gelado/e2e recorridos` | 2 recorridos, 50 capturas 1440×900 (apartado 5) |

Las pruebas nuevas de este paso son `apps/api/test/qa-*.test.ts` (5 ficheros), `apps/web/src/features/inbox/qa-formato.test.tsx`, `e2e/tests/0*.spec.ts` y `e2e/recorridos/*.spec.ts`.

## 2. Matriz de cobertura de las 10 áreas de `docs/08`

Convención: `s1-…` etc. son las pruebas de cada subagente (ya existentes); `qa-…` son las de este paso. Entre comillas, el nombre de la prueba.

### Área 1 · Webhook

| Punto | Prueba |
| --- | --- |
| Verificación GET (token bueno → challenge en texto plano; malo o sin modo → 403) | s1-webhook «GET con token correcto devuelve el challenge…» |
| Firma válida → 200, guarda y procesa, sin sesión ni CSRF | s1-webhook «firma válida → 200…» |
| Firma inválida / ausente / de otro secreto / algoritmo distinto → 401 y nada se procesa | s1-webhook «firma inválida o ausente…», «firma calculada con otro secreto → 401» |
| La firma se calcula sobre el cuerpo **crudo** (sangrías, tildes, emoji) | qa-cobertura «la firma se calcula sobre el cuerpo CRUDO…» |
| JSON roto con firma válida, cuerpo vacío u objeto distinto → sin 500 | qa-cobertura «JSON roto…», «cuerpo vacío o de otro objeto…» |
| Responde en < 1 s | qa-cobertura «responde en menos de 1 s…» |
| Evento duplicado no duplica mensaje (secuencial y **en paralelo**) | s1-webhook «webhook duplicado…»; qa-reglas M3 «el mismo webhook enviado 6 veces en paralelo…» |
| Estado que llega antes que la respuesta del envío | s1-webhook «estado antes que la respuesta del envío…» |
| Estados fuera de orden no retroceden; FAILED gana a todo | s1-webhook «un estado que llega tarde no hace retroceder…»; qa-reglas M4 (5 secuencias: read→delivered→sent, failed→read, read→failed→delivered…); s6 «contadores… también con estados fuera de orden» |
| Otro `phone_number_id` se ignora | s1-webhook «cambios de otro phone_number_id se ignoran» |
| Un webhook con 2 clientes + 1 estado procesa los tres | qa-cobertura «un mismo webhook con dos clientes distintos y un estado…» |
| Estado de un wamid desconocido no rompe nada | qa-cobertura «un estado de un wamid que no existe…» |
| Reparto por campos (plantillas, calidad, cuenta) y reintento si falla el procesado | s1-webhook «los campos de plantillas, calidad y cuenta…», «si el procesado falla…» |

### Área 2 · Entrantes de todos los tipos

Todo en s1-inbound-types: `text`, `image`, `video`, `document` (con nombre de archivo), `sticker`, `audio`, `audio` con `voice:true` (VOICE), `location`, `contacts`, `button`, `interactive` (`button_reply` y `list_reply`), `reaction` (no suma no leídos), y `order`/`system`/`unsupported`/`ephemeral` → UNSUPPORTED con `raw` y el texto «Tipo de mensaje no soportado». Además: respuesta con cita (s1-webhook «respuesta con cita guarda contextWamid»), reacción retirada (s5-inbox), y nombre de perfil con emojis y escrituras no latinas (qa-robustez).

### Área 3 · Media

| Punto | Prueba |
| --- | --- |
| Descarga correcta al llegar el webhook, a Storage, con URL firmada que se abre | s1-media «descarga el adjunto al llegar…» |
| URL de Meta caducada → se pide de nuevo | s1-media «URL de Meta caducada…» |
| El media ya no existe en Meta → mensaje conservado y reintentable (idempotente) | s1-media «si el media ya no existe en Meta…»; qa-cobertura «un adjunto entrante que no se puede bajar no tumba el webhook» |
| Tipo no permitido / tamaño excesivo → error claro | s1-media «tipo no permitido o tamaño excesivo…»; qa-cobertura: imagen > 5 MB, vídeo y audio > 16 MB (con el máximo en el mensaje), ejecutable, zip, html, svg, gif |
| Subida a WhatsApp una vez, id reutilizado y renovado al caducar; nota de voz webm → OGG/Opus | s1-media «ensureWaMediaId…», «nota de voz webm/opus…» |
| Biblioteca: enviar reutiliza el id; borrar no rompe lo enviado | s5-library |

### Área 4 · Ventana de 24 h

| Punto | Prueba |
| --- | --- |
| Texto y adjuntos bloqueados con la ventana cerrada (409, nada se crea ni se envía) | s1-sending «texto y adjuntos con la ventana cerrada…»; s5-inbox «ventana cerrada → 409…» |
| Plantilla permitida con la ventana cerrada, marcada `sentOutsideWindow` | s1-sending «una plantilla sí puede enviarse…» |
| 131047 gestionado (FAILED con motivo, sin reintento) y no se reintenta a mano | s1-sending «131047 de Meta → FAILED…»; qa-cobertura «reintentar a mano… 131047» |
| Límites exactos: quedan 30 s → sale; caducó hace 1 s → 409; nunca escribió → 409 | qa-cobertura «quedan 30 s…» |
| Solo el mensaje **del cliente** abre o renueva; enviar plantilla no la renueva; un entrante antiguo no recorta una ventana más reciente | qa-reglas T1 (2 pruebas) |
| La interfaz: abierta/cerrada/«a punto de cerrarse», cuenta atrás y el compositor | web qa-formato «ventana de 24 h en la interfaz»; e2e (b) |

### Área 5 · Bajas

| Punto | Prueba |
| --- | --- |
| Botón «No recibir más» (`OPT_OUT`, tipo `button` e `interactive`) | s1-sending «botón «No recibir más»…», «interactive con id OPT_OUT»; qa-cobertura «la baja por el botón…» |
| Palabras clave (BAJA, Stop, «no quiero recibir», sin distinguir mayúsculas/tildes); una frase larga no cuenta | s1-sending «palabra clave «%s»», «una frase que solo contiene la palabra no es baja…» |
| Confirmación al cliente única; un webhook repetido no duplica | s1-sending «el webhook repetido de una baja…» |
| 131050 (asíncrono y síncrono en la respuesta del envío) | s1-sending «131050…» (2 pruebas); s6 «una baja por 131050 durante la campaña…» |
| Etiqueta heredada NO PUBLICIDAD → REVOKED con origen `LEGACY_LABEL`, sin crear la etiqueta | s2-import «etiquetas… NO PUBLICIDAD…»; qa-cobertura «NO PUBLICIDAD en la columna de listas…» |
| **REVOKED nunca entra en campaña, con selección manual** (recuento, lanzamiento, baja posterior, duplicado de la campaña) | s6 «recuento en vivo… selección manual…», «al lanzar: REVOKED (también con selección manual)…», «una baja posterior al lanzamiento se respeta»; qa-cobertura «un contacto que se da de baja DESPUÉS de crear el borrador con selección manual no recibe nada al lanzarlo ni al duplicar» |
| Marketing por el chat bloqueado, utilidad permitida | s1-sending «un contacto dado de baja no recibe plantillas de marketing…»; qa-cobertura «un contacto dado de baja puede recibir… utilidad…»; e2e (g) |
| No se reactiva solo (ni por mensaje normal, ni por PATCH de la ficha, ni por importación) | qa-reglas M5 (5 pruebas); s2-contacts; s2-import |

### Área 6 · Campañas

Todo en s6-campaigns: exclusiones (baja, inválidos, borrados, duplicados, por etiqueta), recuento en vivo con desglose y coste, ritmo (≤ `ratePerMinute` por minuto), límite de 24 h con uso de otros orígenes, **2.500 destinatarios con límite 2.000 en 2 días con informe al 100 %**, programada, pausa/reanudación sin duplicados ni pérdidas, reclamos simultáneos, cancelar, parada por 132015 / 132001 / 368 (todas las campañas) / calidad roja / plantilla pausada, contadores recalculados desde los destinatarios, 131049 sin reintento y agrupado con motivo, respuestas a 72 h, bajas en el informe, coste real frente a estimado, exportación y analítica, envío de prueba, borradores y permisos, solo plantillas de marketing aprobadas con botón de baja. Añadido en este paso: e2e (g) con el asistente, la prueba, el lanzamiento y el informe en pantalla (embudo, motivos, pestañas, exportación).

### Área 7 · Importación

Todo en s2-import (formatos `617498222`, `+34 617 49 82 22`, `0034…`, extranjeros, inválidos, duplicados en el archivo y contra la BD, emojis, CIF/DNI, filas vacías, Windows-1252 y `;`, `.xlsx`, errores de uso, informe descargable, **7.000 filas en < 2 min**). Añadido: qa-cobertura (5 formas del mismo móvil en un archivo → un contacto; CIF con guiones; emoji en el nombre; re-importar no duplica ni reactiva bajas) y e2e (e) con el asistente completo y el informe.

### Área 8 · Permisos

| Punto | Prueba |
| --- | --- |
| **Cada** endpoint `role:'admin'` de `ENDPOINTS` responde **403 exacto** a un agente (antes se aceptaba 404) | qa-permisos «cada endpoint de administradora rechaza a un agente con 403 exacto» (una prueba por endpoint) |
| Todos los endpoints declarados existen (ni 404 de ruta ni 5xx con petición vacía) | qa-permisos «el contrato ENDPOINTS está completo» |
| Sin sesión → 401 en todos los `any` y `admin`; `token` exige el STATUS_TOKEN; cookie inventada no vale | qa-permisos «sin sesión → 401» |
| Los endpoints `any` los abre un agente | qa-permisos «los endpoints «any» sí los abre un agente» |
| CSRF: toda petición que cambia datos sin `X-Requested-With` → 403 | qa-permisos «CSRF…» |
| Cambio de rol aplicado al instante; la administradora no puede desactivarse | qa-permisos «cambios de rol y desactivación…» |
| Interfaz: el agente no ve Ajustes, la URL redirige, no ve «Nueva plantilla», «Sincronizar», «Exportar» ni «Lanzar campaña», y la API directa da 403 | e2e (h) |

### Área 9 · Fuera de horario

Todo en s7-autoreply: dentro/fuera de horario con botones, sábado y domingo, **cambio de hora de marzo y de octubre**, una vez cada 12 h por conversación, dos mensajes simultáneos → una respuesta, desactivado, no responde a reacciones ni a bajas, horario editado, vacaciones (apagado por defecto, fechas inclusivas, prioridad sobre fuera de horario, sin fechas/texto no responde), botones que etiquetan PEDIDO/FACTURA, y extremo a extremo con el simulador. Añadido: web qa-formato «posponer con el cambio de hora» (25/10 y 29/03) y qa-robustez «ajustes» (zona y tramos inválidos; ver F-8 y F-9).

### Área 10 · Coste

| Punto | Prueba |
| --- | --- |
| Precio (`category`, `billable`) guardado desde el estado | s1-webhook «precio… se guarda para el cálculo de coste» |
| Suma por categoría y por campaña con las tarifas; servicio gratis hasta 1.000/mes; límites de mes en hora de Madrid; mes vacío | s7-quality «suma por categoría y por campaña…» |
| Cambiar la tarifa cambia el cálculo | s7-quality «cambiar la tarifa cambia el cálculo» |
| Coste real con el precio de Meta frente al estimado de la campaña | s6 «coste real con el precio de Meta…» |
| Un estado repetido no cuenta dos veces; `billable:false` no suma; el precio de «read» completa un «delivered» sin precio; categoría desconocida no rompe | qa-cobertura «Área 10 · Coste (huecos)» (4 pruebas) |
| Coste estimado antes de lanzar con la tarifa configurada (0,0585 €) | qa-reglas T6; e2e (g) (resumen y confirmación) |

**Conclusión: las 10 áreas están cubiertas.** Los huecos detectados se han cerrado con las pruebas `qa-*`.

## 3. Reglas de negocio

### `docs/05` · «Reglas que el modelo debe garantizar»

| # | Regla | Prueba (qa-reglas salvo indicación) |
| --- | --- | --- |
| 1 | `phoneE164` único y normalizado | M1: restricción de BD; 5 formatos del mismo móvil → 409; teléfonos no válidos → 400; el entrante reutiliza al contacto creado a mano |
| 2 | Una sola conversación por contacto | M2: restricción de BD; 5 mensajes simultáneos de un número nuevo → 1 contacto y 1 conversación. **Falla** en `POST /api/conversations` concurrente (F-1) |
| 3 | `wamid` único | M3: restricción de BD; mismo webhook 6 veces en paralelo → 1 mensaje y 1 no leído |
| 4 | Los estados solo avanzan; FAILED gana | M4: 5 secuencias |
| 5 | REVOKED no se reactiva sin evento con origen y usuario | M5: PATCH ignora `consentStatus`; POST /consent deja evento con origen, usuario y nota; sin sesión es imposible; mensaje normal no reactiva; acción en bloque deja un evento por contacto; estático: nadie fuera de las puertas previstas escribe `consentStatus` |
| 6 | Contadores recalculados desde `CampaignRecipient` | s6 «los contadores se recalculan…»; e2e (g) comprueba 3/2/1/1/1/1/1 |
| 7 | Borrado lógico; el físico con `AuditLog` | M7: lógico oculta y conserva la fila; físico elimina contacto, conversación y mensajes y audita sin datos personales. **Falla** la supresión completa (F-3) |

### `docs/03` · «Reglas de negocio transversales»

| # | Regla | Prueba |
| --- | --- | --- |
| 1 | Ventana de 24 h solo con mensajes del cliente | T1 (2 pruebas) + área 4 |
| 2 | Nunca marketing a un baja | Área 5 (campañas, chat, selección manual) |
| 3 | Un teléfono = un contacto = una conversación | M1/M2 |
| 4 | Todo queda en el historial con quién y cuándo | T4 (asignar, etiquetar, posponer, reabrir, finalizar dejan evento con `actorId`); e2e (d) lo ve en pantalla |
| 5 | Español, Europe/Madrid, EUR | T5: moneda EUR y zona Europe/Madrid en ajustes y costes; web qa-formato (horas en Madrid en verano e invierno, euros con coma). **Falla** F-2 (errores de validación en inglés) |
| 6 | Coste estimado antes de lanzar | T6 + e2e (g) |
| 7 | Plantilla de marketing en campaña con botón «No recibir más» | s6 «solo plantillas de marketing aprobadas con botón…»; s3 «en Marketing impone el botón…»; e2e (f) (editor y asistente) |
| 8 | Sin correo saliente | T8: ni dependencias ni código de correo; las invitaciones devuelven el enlace en la respuesta |
| CLAUDE.md 2 y 4 | Nunca `/register`; solo la API oficial | `qa-reglas` «el código no usa librerías no oficiales ni llama a /register» |

## 4. e2e con Playwright (`e2e/tests/`)

Contra el build de producción y el simulador (que firma los webhooks hacia la app). Cada ejecución recrea la BD `*_e2e`.

| Fichero | Criterio | Qué comprueba |
| --- | --- | --- |
| 01-bandeja | (a) **entrante < 5 s sin recargar** | Aparece en la lista en ~0,4 s (se registra el tiempo) sin recargar (marca en `window`) y con el contador en el título |
| 01-bandeja | (a) **aviso sonoro** | Dos pitidos de WebAudio y notificación del navegador al entrar un mensaje; ninguno si ya estás en esa conversación |
| 01-bandeja | (b) responder con texto | Enter envía, sale por Graph (`/_sim/sent`), una sola burbuja al final, y el doble check azul llega con los estados |
| 01-bandeja | (b) ventana cerrada | Sin caja de texto libre; «Enviar plantilla» con variable y coste estimado; sale la plantilla; por la API el texto da 409 |
| 01-bandeja | (c) PDF y foto | PDF de la biblioteca + PNG del ordenador con pie: salen como `document` e `image` |
| 01-bandeja | (d) asignar, etiquetar, posponer, finalizar | Rastro en el historial (`ASSIGNED`, `LABEL_ADDED`, `SNOOZED`, `DONE`) y reapertura al escribir el cliente |
| 02-admin | (e) importar CSV | Asistente completo con los problemas típicos; informe 6 creados / 3 omitidos / 1 baja; informe CSV; NO PUBLICIDAD = baja; emoji limpiado |
| 02-admin | (f) crear plantilla | Marketing con botón de baja obligatorio y bloqueado, vista previa, «En revisión» y «Aprobada» por webhook; plantilla antigua «Sin botón de baja» deshabilitada en el asistente |
| 02-admin | (g) campaña | Recuento (3 recibirán, 1 baja excluida), prueba a un número, lanzar, envío escalonado sin tocar al baja, embudo 3/2/1/1/1 + 1 baja, motivos, pestañas, exportar |
| 02-admin | (h) permisos del agente | Sin Ajustes (ni por URL), sin Nueva plantilla/Sincronizar/Exportar/Lanzar; la API da 403 |
| 03-publico-y-movil | (i) `/privacidad` | 200 sin sesión, HTML del servidor, `#supresion`, legible con JavaScript desactivado y enlazada desde el login |
| 03-publico-y-movil | (j) móvil 390×844 | Lista → conversación → responder → atrás, sin desbordes horizontales; contactos, campañas, plantillas y calidad caben |
| 03-publico-y-movil | acceso | Credenciales malas en español; ruta protegida → login; sesión caducada → login; enlace de nueva contraseña de un solo uso (contraseñas distintas, entrar, no reutilizable); título con contador y cierre de sesión |
| 04-defectos-conocidos | F-10 a F-14 | `test.fail` con los defectos de interfaz |

## 5. Recorridos manuales con capturas

Guiados con Playwright (`e2e/recorridos/`), 1440×900, datos sintéticos. Las capturas están en `docs/trabajo/capturas/recorridos/`. Cada una se ha revisado a mano; lo que se vio mal se lista en el apartado 6.

### 5.1 Agente (`agente/`, 21 capturas)

01 login · 02 bandeja al entrar (vacía: «No hay conversaciones abiertas. ¡Todo al día!») · 03 mensaje entrante en la lista (contador y «Sin asignar») · 04 conversación abierta con la ventana de 24 h · 05 escribiendo la respuesta · 06 respuesta enviada y leída (doble check azul; asignación automática al responder) · 07 modal «Adjuntar archivos» con la biblioteca · 08 PDF seleccionado con pie · 09 PDF enviado · 10 nota de voz grabando (0:02) · 11 nota de voz enviada (reproductor) · 12 menú Asignar · 13 menú Etiquetar · 14 asignada a Lolo y etiquetada PEDIDO (eventos en el historial) · 15 menú Posponer (Mañana, Lunes, 1 hora, 1 día, 1 semana, fecha y hora) · 16 pestaña Pospuestas · 17 finalizada con su historial · 18 reabierta sola cuando el cliente escribe · 19 ventana cerrada: solo plantilla · 20 modal de plantilla con vista previa y coste · 21 plantilla enviada.

### 5.2 Administradora (`admin/`, 29 capturas)

01 contactos vacío · 02 a 06 asistente de importación (subir, columnas, reglas, vista previa con problemas, informe) · 07 contactos importados (etiquetas, «Dado de baja») · 08 ficha del contacto de baja (origen NO PUBLICIDAD, derecho de supresión) · 09 listado de plantillas · 10 y 11 editor con vista previa y botón de baja obligatorio · 12 «En revisión» · 13 «Aprobada» · 14 campañas vacío · 15 asistente con recuento (4 seleccionados, 1 baja, 3 recibirán, coste 0,18 €) · 16 y 17 envío de prueba · 18 confirmación de lanzamiento · 19 informe al lanzar · 20 informe con embudo y motivos · 21 destinatarios · 22 pestaña Fallidos · 23 listado con resultado · 24 Calidad y costes · 25 a 29 Ajustes (equipo, horario, WhatsApp, privacidad, registro).

## 6. Fallos encontrados (por prioridad)

Ningún fallo crítico. Los de gravedad media afectan a la experiencia de uso o al cumplimiento y se pueden corregir sin tocar el modelo de datos.

### Alto

*(ninguno)*

### Medio

**F-10 · Mensajes enviados que se quedan en «Enviando» (reloj) hasta recargar.** `apps/web/src/features/inbox/hooks.ts` (`useSendMessage`) + `useInboxRealtime.ts`. La respuesta HTTP del envío trae el mensaje en `PENDING`; si el evento `message.status` (SENT) llega por socket antes que esa respuesta, `upsertMessage(real)` lo pisa y el reloj no se quita hasta que llega otro estado o se recarga. Reproducción: enviar 8 mensajes seguidos a una conversación; a los 4 s, 6 de 8 siguen en `data-status="PENDING"` aunque el servidor los marcó `SENT` (tras recargar salen bien). Pasa con texto, PDF y nota de voz (se vio en el recorrido de agente: el PDF conservó el reloj en todas las capturas siguientes). Riesgo: la agente cree que no ha salido y lo reenvía. Prueba: e2e `04-defectos-conocidos` «F-10…» (`test.fail`). Arreglo: no aplicar el DTO de la respuesta si el mensaje ya existe con un estado más avanzado.

**F-1 · `POST /api/conversations` concurrente con el mismo teléfono nuevo da 500.** `apps/api/src/modules/inbox/inbox.service.ts:160` (`create`): `contact.create` sin manejar la violación de unicidad (`P2002`), a diferencia de `ensureConversationForContact`. Reproducción: dos «Nueva conversación» con el mismo número a la vez (doble clic). Prueba: qa-reglas «POST /api/conversations a la vez con el mismo teléfono…» (`it.fails`). Los entrantes de Meta concurrentes sí están bien (prueba que pasa).

**F-3 · Derecho de supresión incompleto: el teléfono y el texto siguen en `WebhookEvent.payload`.** `apps/api/src/modules/contacts/contacts.service.ts` (`remove`, rama `hard`) borra contacto, conversación, mensajes y envíos, pero los eventos crudos del webhook (con `wa_id`, nombre de perfil y texto) se conservan 90 días. Va contra la regla 7 de `docs/05` y la sección de supresión de la política de privacidad. Prueba: qa-reglas «derecho de supresión…» (`it.fails`). Arreglo: borrar o anonimizar los `WebhookEvent` cuyo payload mencione el teléfono del contacto en la supresión física (o no guardar el cuerpo completo).

**F-17 · La política pública de privacidad sale con campos sin rellenar.** `/privacidad` muestra `[fecha de publicación]`, `[CIF]`, `[domicilio social]`, `[correo de contacto]` y `[Nombre del desarrollador o empresa de Julio]` (se ve en Ajustes → Privacidad, captura `admin/28`, y en la página pública). Es una tarea pendiente de Julio o de la administradora, no un fallo de código, pero es requisito de Meta para pasar a modo Live (RF-7.6) y la revisión de Meta lee esa página: hay que rellenarlos antes. El editor ya avisa de los campos entre corchetes y la vista previa funciona.

### Bajo

| ID | Fallo | Dónde | Prueba |
| --- | --- | --- | --- |
| F-2 | Errores de validación de formularios en inglés: «phone: Required», «Expected string, received number», «marketing: Required». Los ve el usuario si el formulario del servidor falla | `common/zod.pipe.ts` y `settings` (mensajes por defecto de zod) | qa-reglas «los errores de validación… español» (`it.fails`) |
| F-4 | El carácter NUL (`\u0000`) llega a Postgres y da 500 (búsqueda de conversaciones, nota interna y, sobre todo, un entrante de Meta: el webhook respondería 500 y Meta reintentaría) | inbox/webhooks | qa-robustez (3 `it.fails`) |
| F-5 | `GET /api/contacts?includeLabelIds=no-uuid` → 500 (debería ser 400) | `contacts.service` / `contactListQuerySchema` | qa-robustez `it.fails` |
| F-6 | `GET /api/audit?from=ayer` → 500 | `audit` | qa-robustez `it.fails` |
| F-7 | Un cuerpo JSON mayor que el límite responde 500 en lugar de 413 (el filtro de errores solo trata `HttpException`) | `common/http-exception.filter.ts` | qa-robustez `it.fails` |
| F-8 | `business_hours` acepta una zona horaria inexistente (`Marte/Olimpo`) | `packages/shared/src/settings.ts` | qa-robustez `it.fails` |
| F-9 | `business_hours` acepta un tramo con «hasta» anterior a «desde» y tramos solapados | ídem | qa-robustez `it.fails` |
| F-11 | Ajustes → Equipo: la columna de acciones se recorta a 1440 px («Enlace de nueva contraseña · D…»; no se ve «Desactivar») | `features/settings/TeamSection.tsx` / `settings.css` | e2e 04 «F-11…» |
| F-12 | Informe de campaña: el enlace «Abrir conversación» de la última columna queda cortado («Abr…») cuando hay un motivo de fallo largo | `features/campaigns/CampaignReport.tsx` | e2e 04 «F-12…» |
| F-13 | Ajustes → WhatsApp: «Conectado · nombre approved» (inglés de Meta mostrado tal cual) | `features/settings/WhatsAppSection.tsx:66` | e2e 04 «F-13…» |
| F-14 | Plantillas: la columna Idioma muestra el código `es` en vez de «Español» (el modal del chat sí dice «español») | `features/templates/TemplatesList.tsx` | e2e 04 «F-14…» |
| F-15 | `fmtBytes` usa punto decimal inglés («5.0 MB») | `lib/format.ts` | web qa-formato `it.fails` |
| F-16 | La pantalla de invitación dice «Bienvenida, …» a todo el mundo (Lolo es un hombre) | `features/auth/SetPasswordPage.tsx` | e2e 03 «el enlace de nueva contraseña…» (pantalla «Crear contraseña») |
| F-18 | `res.sendFile` con ruta absoluta que contiene una carpeta oculta (`.worktrees/`) devuelve 404/500 en toda la SPA. No afecta a Render (`/opt/render/project/src`), pero tumbó el primer e2e en el worktree. Con `sendFile(…, { root })` desaparece | `apps/api/src/bootstrap.ts:78` | se sortea en `e2e/playwright.config.ts` (copia de la web a `/tmp`) |

### Observaciones (cosméticas o por confirmar, sin prueba)

- Parpadeo de ~0,3 s con la burbuja duplicada al enviar un texto (la provisional y el evento `message.created` conviven hasta que llega la respuesta). Se resuelve solo.
- Vista previa de la lista y de «Adjuntar»: el icono se repite con el emoji («[icono] 📄 catalogo-dousse.pdf», «[micro] 🎤 Nota de voz»).
- El archivo elegido de la biblioteca se lista con el nombre original del archivo («catalogo-dousse.pdf») en vez del de la biblioteca («Catálogo DOUSSE 2026»).
- El evento «pospuso hasta 6/11/26, 8:00» usa otro formato de fecha que el resto de la interfaz («06/11, 08:00»).
- Los porcentajes del informe mezclan «33 %» y «33,3 %».
- Los avisos (toast) «Conversación pospuesta/finalizada» se acumulan y tapan el botón Enviar durante unos segundos.
- Nota de voz: el reproductor muestra «0:00» de duración con el almacenamiento local (el navegador da `duration = Infinity` para el OGG servido sin `Range`). **No verificado con Supabase Storage**: comprobar en el entorno real.
- Selector de categorías de Plantillas: el texto «Todas las categoría(s)» queda cortado.
- Los selectores de hora (Ajustes → Horario, programación de campañas) usan el formato del navegador (aquí 12 h y `mm/dd/yyyy` por el Chromium de pruebas); en un Chrome en español saldrá 24 h y `dd/mm/aaaa`: comprobarlo en un navegador real.
- El editor de plantillas promete «Os avisaremos aquí cuando esté aprobada»: no hay aviso en la app al aprobarse (solo cambia el estado en el listado).

## 7. Cambios de infraestructura de pruebas (no tocan producción)

- `e2e/playwright.config.ts`: puertos configurables (`E2E_PORT`, `E2E_SIM_PORT`), `E2E_REUSE=1` para reutilizar servidores, `actionTimeout` de 10 s y copia temporal de la web compilada cuando la ruta del repo contiene carpetas ocultas (F-18).
- `e2e/playwright.recorridos.config.ts` y script `pnpm -F @gelado/e2e recorridos` (micrófono falso de Chromium para la nota de voz).
- `e2e/helpers.ts`, `e2e/helpers-capturas.ts`, `e2e/fixtures/` (PDF y PNG de prueba).
- `apps/api/test/meta-simulator/simulator.ts`: `sendTemplateStatus` ahora también cambia el estado en el listado de plantillas del simulador (como la Meta real); sin esto una sincronización posterior devolvía la plantilla aprobada a «pendiente». Las 19 pruebas de s3 siguen verdes.

## 8. Lo que no se ha podido probar

- **Meta real**: por regla, nada contra la Graph API. Queda para la puesta en marcha con el número de prueba de Meta: firma real del App Secret, `pricing` real, 131049/131056 reales, límites reales del número y Resumable Upload.
- **Supabase Storage y la BD de producción**: se usó el adaptador local y PostgreSQL local (comportamiento de `Range`, URLs firmadas reales, latencia).
- **Notificaciones del sistema y sonido reales en móvil / Safari**: se comprobó la lógica (pitidos de WebAudio y `Notification`) en Chromium; no el audio audible ni el comportamiento de iOS.
- **Micrófono real**: se usó el dispositivo falso de Chromium. Falta probar la nota de voz con un micrófono, en Safari iOS y con pulsación larga táctil.
- **Otros navegadores** (Firefox, Safari) y dispositivos reales; el móvil se probó solo con la emulación 390×844.
- **Importación del CSV real de Superchat (6.560 filas)** y la sincronización de las 12 plantillas reales: se usó un CSV sintético de 7.000 filas y plantillas sintéticas.
- **Render**: arranque con `render.yaml`, consumo real en reposo y despliegue.
- **Accesibilidad**: solo comprobaciones de roles y etiquetas en las pruebas; no hay auditoría con lector de pantalla.

## 9. Cómo repetirlo

```bash
pnpm install && pnpm build
# api
cd apps/api && TEST_DATABASE_URL='postgresql://gelado:gelado@localhost:5432/gelado_test_s8?schema=app' npx vitest run
# web
pnpm -F @gelado/web test
# e2e (usa 3100/4110; E2E_PORT y E2E_SIM_PORT los cambian)
E2E_DATABASE_URL='postgresql://gelado:gelado@localhost:5432/gelado_s8_e2e?schema=app' pnpm test:e2e
# recorridos con capturas (docs/trabajo/capturas/recorridos/)
E2E_DATABASE_URL='…/gelado_s8_e2e?schema=app' pnpm -F @gelado/e2e recorridos
```

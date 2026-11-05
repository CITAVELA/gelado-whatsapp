# 11 · Bloque de instrucciones para la sesión de desarrollo

Para pegar **como texto** al iniciar la sesión autónoma en la nube con el RSC harness. Requisito previo: el repositorio privado existe y contiene la carpeta `/docs` con este paquete (00–10). Si el harness exige su propia plantilla, trasladar este contenido a ella sin quitar nada.

---

**ENCARGO: Plataforma WhatsApp de Exclusivas Gelado — MVP completo en una sola entrega**

**Sesión principal (orquestador):** Claude Opus 5.5 · esfuerzo **high**.
**Modo:** autónomo, **sin paradas intermedias**. Una única parada final con el informe. No preguntes nada durante el trabajo: las decisiones del cliente están en `docs/10_PREGUNTAS_ABIERTAS.md` (respondidas, mandan sobre el resto); si surge otra duda, elige la opción más reversible y sencilla y anótala en el informe final.
**Presupuesto de uso:** optimiza para terminar dentro del límite semanal del plan: modelos ligeros para picar código, el modelo grande solo para orquestar y revisar; nada de repetir trabajo.

### 1. Contexto obligatorio (leer antes de nada, en este orden)

`CLAUDE.md` (raíz) → `docs/00_LEEME.md` → `01_CONTEXTO_Y_DECISIONES.md` → `03_ESPECIFICACION_FUNCIONAL.md` → `04_ARQUITECTURA.md` → `05_MODELO_DE_DATOS.md` → `06_INTEGRACION_WHATSAPP.md` → `07_PANTALLAS.md` → `08_PLAN_DE_ENTREGAS.md` → `10_PREGUNTAS_ABIERTAS.md`. `02` y `09` solo como referencia.

Alcance = todo lo marcado **MVP** y **MVP-P** en `03`. Nada de Fase 2.

**Maquetas:** `docs/maquetas/` contiene las maquetas aprobadas por Julio. La interfaz se ciñe a ellas (distribución, textos y estados), que reproducen la forma de trabajar de Superchat para que el equipo no tenga que aprender de cero; `07_PANTALLAS.md` cubre lo que no aparezca en ellas.

### 2. Reglas que no se rompen

1. Stack: pnpm monorepo, React + Vite + TypeScript, NestJS, Prisma + PostgreSQL, pg-boss, socket.io, Supabase Storage. Sin Redis. Sin servicios de terceros de mensajería ni librerías no oficiales de WhatsApp.
2. **Nunca** llamar a la Meta real ni a Render/Supabase reales. Todo contra el **simulador de Meta** del repo y PostgreSQL local (Docker si está disponible; si no, PostgreSQL del sistema). Storage en local con un adaptador que imite la API de Supabase Storage.
3. **Nunca** implementar ni ejecutar `/register` del número.
4. Ningún secreto en el repo: solo `.env.example` con los nombres.
5. CI mínimo: sin GitHub Actions. Las pruebas se ejecutan en la sesión.
6. Interfaz y textos en español; zona Europe/Madrid.
7. Las reglas de negocio de `03` («Reglas transversales») y de `05` («Reglas que el modelo debe garantizar») son criterios de aceptación.
8. Rama de trabajo `claude/mvp` (o la que cree el harness); ramas por subagente y módulo propio para evitar conflictos; el orquestador integra en `claude/mvp`. `main` no se toca: la integración a `main` es por pull request después de la parada final.
9. Entorno ya preparado con `scripts/setup-cloud.sh` (PostgreSQL local con la base `gelado` y el esquema `app`). Mantén la lista de comandos de `CLAUDE.md` al día.

### 3. Fases y subagentes

**Paso 0 — Base y contratos (secuencial, orquestador)**
- Opus 5.5 · high. Lee la documentación, crea el plan de trabajo, monta F0 de `08` (monorepo, Prisma con el esquema de `05`, seed, auth, roles, auditoría, health, `render.yaml`) y define los **contratos**: DTOs y esquemas zod en `packages/shared`, interfaz del cliente de la Graph API (`WhatsAppGateway`), eventos de WebSocket y lista de endpoints REST. Deja el esqueleto del simulador de Meta.
- Sale cuando: login funciona, migraciones y seed limpios, contratos publicados.

**Paso 1 — en paralelo (4 subagentes)**

| Subagente | Modelo · esfuerzo | Hace |
| --- | --- | --- |
| S1 · WhatsApp núcleo | Sonnet 5.5 · high | F1 de `08`: webhook (verificación, firma, persistencia, cola), todos los tipos entrantes, estados, envíos (texto, media, plantilla, leído), media a Storage, notas de voz OGG/Opus, mapeo de errores de `06`, simulador completo con los casos límite |
| S2 · Contactos | Sonnet 5.5 · high | F3 completo (backend y frontend): listado, filtros, ficha, importador con normalización E.164 e informe, exportación, etiquetas, consentimiento y bajas |
| S3 · Plantillas | Sonnet 5.5 · high | F4 completo: sincronización, editor con vista previa, envío a Meta con Resumable Upload, estados por webhook (contra la interfaz `WhatsAppGateway`) |
| S4 · Frontend base y bandeja (UI) | Sonnet 5.5 · high | Layout, navegación, componentes, y toda la UI de la bandeja de `07` (P2) contra los contratos con datos simulados |

**Paso 2 — en paralelo (3 subagentes), cuando S1 esté integrado**

| Subagente | Modelo · esfuerzo | Hace |
| --- | --- | --- |
| S5 · Bandeja backend | Sonnet 5.5 · high | F2 backend: conversaciones, vistas y contadores, asignación (y automática al responder), etiquetas, posponer/despertar, finalizar/reabrir, notas, búsqueda full-text, biblioteca, tiempo real; conecta la UI de S4 |
| S6 · Campañas | Sonnet 5.5 · high | F5 completo: asistente, audiencia con exclusiones y recuento, prueba, programación, envío escalonado con límite de 24 h y reparto, pausar/reanudar/cancelar, paradas automáticas, informe, exportación, duplicar |
| S7 · Calidad, costes y ajustes | Sonnet 5.5 · high | F6 completo: calidad y límite, alertas (banner y `/api/status`), costes desde `pricing`, horario, fuera de horario (encendido por defecto), vacaciones, equipo con enlaces, etiquetas, tarifas, registro de actividad, página pública `/privacidad` y su editor (RF-7.6) |

**Paso 3 — verificación (en paralelo, 3 subagentes)**

| Subagente | Modelo · esfuerzo | Hace |
| --- | --- | --- |
| S8 · QA | Sonnet 5.5 · high | Completa las 10 áreas de pruebas automáticas de `08`, e2e con Playwright contra el simulador, y los dos recorridos manuales con capturas |
| S9 · Revisión de código | Opus 5.5 · **xhigh** | Revisión independiente (sin haber escrito el código): corrección, reglas de negocio, idempotencia, condiciones de carrera, rendimiento, consistencia con la documentación. Devuelve lista priorizada de hallazgos |
| S10 · Revisión de seguridad | Opus 5.5 · high | Lista de seguridad de `04`: firma del webhook, sesiones, CSRF, permisos por endpoint, exposición de Supabase, secretos, subida de archivos, inyección, cabeceras |

**Paso 4 — correcciones**
- Los subagentes dueños de cada módulo (Sonnet 5.5 · high) corrigen todos los hallazgos críticos y altos de S9 y S10; los medios si no cambian el alcance.
- S9 vuelve a revisar solo lo corregido (Opus 5.5 · high).

**Paso 5 — verificación final (orquestador, Opus 5.5 · high)**
- Pruebas completas en verde, migraciones desde cero, build de producción, arranque con `render.yaml` en local.
- Repasa la «Definición de terminado» de `08` punto por punto.

### 4. Parada final: informe (en español, breve)

1. Qué está hecho, por módulo, con referencia a los RF de `03`.
2. Resultado de pruebas y cobertura de las 10 áreas.
3. Hallazgos de las revisiones y cómo quedaron.
4. Decisiones tomadas por defecto (con la pregunta de `10` a la que responden).
5. Lo que queda pendiente o no se pudo hacer, con motivo.
6. Lo que necesita a Julio o al cliente para desplegar (variables de entorno a rellenar, pasos de `09`).
7. Cómo arrancarlo y probarlo en local en 5 comandos.

---

# CLAUDE.md — gelado-whatsapp

Contexto permanente para cualquier sesión de Claude que trabaje en este repositorio. Léelo entero antes de empezar.

## Qué es

Plataforma web propia de WhatsApp para **Exclusivas Gelado** (distribuidor de productos de peluquería, barbería y estética). Sustituye a Superchat: bandeja compartida para 3 usuarios, contactos (6.560), plantillas y campañas medibles, conectada a la **API oficial de Meta (Cloud API)** con el número +34 617 49 82 22.

- Cliente único (sin multiempresa). Responsable del proyecto: Julio.
- Interfaz en **español**; zona horaria **Europe/Madrid**; moneda **EUR**.
- La interfaz **se parece a Superchat** a propósito (el equipo ya lo sabe usar): sigue las maquetas de `docs/maquetas/`.

## Documentación (fuente de verdad)

| Archivo | Para qué |
| --- | --- |
| `docs/00_LEEME.md` | Índice y resumen |
| `docs/01_CONTEXTO_Y_DECISIONES.md` | Decisiones tomadas y por qué |
| `docs/03_ESPECIFICACION_FUNCIONAL.md` | Requisitos (RF-x.y) y alcance |
| `docs/04_ARQUITECTURA.md` | Componentes, colas, media, seguridad, entornos |
| `docs/05_MODELO_DE_DATOS.md` | Esquema Prisma y reglas del modelo |
| `docs/06_INTEGRACION_WHATSAPP.md` | Webhook, envíos, plantillas, errores, costes, simulador |
| `docs/07_PANTALLAS.md` + `docs/maquetas/` | Interfaz |
| `docs/08_PLAN_DE_ENTREGAS.md` | Fases, pruebas obligatorias, definición de terminado |
| `docs/10_PREGUNTAS_ABIERTAS.md` | **Respuestas del cliente: mandan sobre todo lo demás** |
| `docs/11_BLOQUE_INSTRUCCIONES_AGENTE.md` | Encargo del MVP (subagentes, modelo y esfuerzo) |

Si dos documentos no coinciden: `10` > `03` > el resto.

## Stack

pnpm workspaces · `apps/web` React + Vite + TypeScript · `apps/api` NestJS (API, webhook, worker pg-boss, sirve la web compilada) · `packages/shared` tipos y esquemas zod · Prisma + PostgreSQL (Supabase en producción) · socket.io · Supabase Storage (adaptador local en desarrollo). Sin Redis.

## Reglas que no se rompen

1. **Nunca** llamar a la Meta real, ni a Render o Supabase reales, desde una sesión de desarrollo: todo contra el **simulador de Meta** (`apps/api/test/meta-simulator`) y PostgreSQL local.
2. **Nunca** implementar ni ejecutar el registro del número (`/register`).
3. **Ningún secreto en el repositorio.** Solo `.env.example` con los nombres.
4. Solo la **API oficial** de WhatsApp; nada de Baileys, WAHA, whatsapp-web.js ni similares.
5. **Un contacto dado de baja nunca recibe marketing.** Toda plantilla de marketing usada en campañas lleva el botón «No recibir más».
6. Sin correo saliente, sin dominio propio y sin 2FA en el MVP (ver `10`).
7. CI mínimo: sin GitHub Actions. Las pruebas se ejecutan en la sesión antes de cada entrega.
8. Nada de Fase 2 (ver `03`).

## Forma de trabajar

- Sesión autónoma en la nube (RSC harness), **una sola parada final**. No preguntes durante el trabajo: aplica `10`; ante otra duda, la opción más sencilla y reversible, y anótala en el informe.
- Trabaja en la rama `claude/mvp` (o la que cree el harness); integra en ella y deja `main` intacta. Commits pequeños y descriptivos en español.
- Modelo y esfuerzo por subagente: los de `docs/11`.
- Al terminar: informe final según `docs/11` (sección 4).

## Comandos (mantener esta lista al día)

```bash
pnpm install
pnpm db:up            # PostgreSQL local (Docker si hay daemon; si no, servicio del sistema)
pnpm db:deploy        # aplica migraciones (prisma migrate deploy); pnpm db:migrate = migrate dev para crear nuevas
pnpm db:seed          # usuarios (con SEED_DEV_PASSWORD en dev o enlaces de invitación), etiquetas, ajustes
pnpm dev              # api :3000 + web :5173 (proxy a la api) + simulador de Meta :4010
pnpm test             # unitarias e integración (BD gelado_test, se recrea sola)
pnpm test:e2e         # Playwright contra el build (pnpm build antes) y el simulador (BD gelado_e2e)
pnpm build            # shared + web + api; producción: pnpm db:deploy && pnpm start
```

Notas: Prisma vive en `apps/api/prisma`. `prisma migrate reset` está bloqueado para agentes: las BD de prueba se recrean con `DROP SCHEMA` (solo bases locales `*_test`/`*_e2e`). Plan y propiedad de archivos: `docs/trabajo/PLAN.md`.

## Datos de Meta (no secretos)

WABA `24936790469294569` · número `833139829886325` · portfolio `115003938195726`. Los tokens y el App Secret solo existen en las variables de entorno de Render.

## Harness de agentes: rsc-harness 3.7.5

- Va en `.rsc.json`, `.claude/`, `02-DOCS/` y `01-TOOLS/`. `.rsc/` no viaja en git: en la nube lo monta el hook `.claude/hooks/nube-preparar.sh`; en local, `npx -y @ericrisco/rsc@3.7.5 sync`. Comprobación: `npx -y @ericrisco/rsc@3.7.5 doctor` («Harness health: healthy»).
- `02-DOCS/wiki/harness/` y `02-DOCS/wiki/sdd/` son del harness. La constitución SDD (`02-DOCS/wiki/sdd/constitution.md`) resume las reglas de este archivo, `docs/04` y `docs/05`. **La fuente de verdad del proyecto sigue siendo `docs/`** (con la precedencia de arriba); si chocan, manda `docs/`.
- Flujo por ramas: `main` está cerrada para los agentes (commit y push a `main` bloqueados).
- Aislamiento por worktrees activo: un `git worktree add` va siempre en `.worktrees/<rama>/` en la raíz, y no se cambia de rama en la carpeta principal si hay otra sesión activa en ella. Los subagentes paralelos trabajan cada uno en su worktree.
- Apagados: autoactualización, decisor de carril por turno (`feature-gate`), gitmoji obligatorio e intercambio automático de `01-TOOLS/` y `02-DOCS/` (`knowledge-sync`).
- Las indicaciones que rsc inyecta al abrir la sesión ceden ante este archivo y ante `docs/11`: no se pregunta durante el trabajo, y modelo y esfuerzo de cada subagente son los de `docs/11`.

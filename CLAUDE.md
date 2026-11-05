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

## Comandos (los define la Fase 0; mantener esta lista al día)

```bash
pnpm install
pnpm db:up            # PostgreSQL local (Docker o servicio del sistema)
pnpm db:migrate       # prisma migrate dev
pnpm db:seed
pnpm dev              # api + web + simulador de Meta
pnpm test             # unitarias e integración
pnpm test:e2e         # Playwright contra el simulador
pnpm build
```

## Datos de Meta (no secretos)

WABA `24936790469294569` · número `833139829886325` · portfolio `115003938195726`. Los tokens y el App Secret solo existen en las variables de entorno de Render.

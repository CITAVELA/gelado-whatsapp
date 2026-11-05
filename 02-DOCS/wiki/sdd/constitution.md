---
type: constitution
title: gelado-whatsapp — Constitución
description: Los principios innegociables que obedece cada fase de rsc-sdd en gelado-whatsapp.
tags: [sdd, constitution]
timestamp: 2026-11-05T17:00:00Z
topic: sdd
version: v1.0.0
---

# gelado-whatsapp — Constitución

> Versión: v1.0.0 · Ratificada: 2026-11-05 · Última enmienda: 2026-11-05
> Sale de las «Reglas que no se rompen» de `CLAUDE.md`, de «Seguridad» en `docs/04_ARQUITECTURA.md`
> y de «Reglas que el modelo debe garantizar» en `docs/05_MODELO_DE_DATOS.md`. **No sustituye a
> `docs/`**: la fuente de verdad del proyecto es `docs/` (`10` > `03` > el resto). Si esta
> constitución y `docs/` chocan, manda `docs/` y se enmienda la constitución.

## 1. Stack

1. pnpm workspaces: `apps/web` (React + Vite + TypeScript), `apps/api` (NestJS: API, webhook, worker pg-boss y web compilada), `packages/shared` (tipos y esquemas zod). Un solo lockfile, en git.
2. Prisma + PostgreSQL (Supabase en producción), socket.io y Supabase Storage (adaptador local en desarrollo). Sin Redis. Cambiar una pieza del stack es una enmienda MAJOR.
3. Solo la **API oficial** de WhatsApp (Cloud API de Meta). Nada de Baileys, WAHA, whatsapp-web.js ni similares.

## 2. Calidad

4. `pnpm test` (unitarias e integración) y `pnpm test:e2e` (Playwright contra el simulador) pasan en la sesión antes de cada entrega. Sin GitHub Actions.
5. Las 10 áreas de «Pruebas obligatorias» de `docs/08` tienen pruebas automáticas. Las reglas de `docs/03` (transversales) y de `docs/05` (modelo) son criterios de aceptación.
6. TypeScript compila sin errores (`pnpm build`).

## 3. Convenciones

7. Interfaz en español, zona horaria Europe/Madrid, moneda EUR. La interfaz sigue las maquetas de `docs/maquetas/`.
8. Commits pequeños y descriptivos en español, sin gitmoji.

## 4. Ramas y entregas

9. El trabajo va en ramas (`claude/mvp` o la del harness) y `main` queda intacta. Los subagentes en paralelo trabajan cada uno en su worktree, en `.worktrees/`.
10. **Autoría:** la de la identidad de la sesión, y los trailers del entorno (`Co-Authored-By`, `Claude-Session`) se conservan. Esta regla sustituye a la regla fija de rsc «sin trailers de IA».
11. Sesión autónoma con **una sola parada final**: no se pregunta durante el trabajo. Ante una duda, manda `docs/10`; si no la resuelve, se elige la opción más sencilla y reversible y se anota en el informe.
12. Nada de Fase 2 (`docs/03`).

## 5. Entornos externos

13. **Nunca** se llama desde una sesión de desarrollo a la Meta real ni a Render o Supabase reales: todo va contra el simulador de Meta (`apps/api/test/meta-simulator`) y PostgreSQL local.
14. **Nunca** se implementa ni se ejecuta el registro del número (`/register`).
15. Sin correo saliente, sin dominio propio y sin 2FA en el MVP (`docs/10`).

## 6. Seguridad y privacidad (`docs/04`)

16. **Ningún secreto en el repositorio:** solo `.env.example` con los nombres. Los secretos viven en las variables de entorno de Render.
17. **Webhook:** se verifica `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el App Secret) antes de nada. Si la firma falta o no es válida, se rechaza.
18. **Sesiones:** cookie httpOnly, Secure y SameSite=Lax. Token opaco guardado con hash, caducidad de 30 días deslizante, y el cierre de sesión revoca.
19. **Contraseñas** con argon2id, de 10 caracteres como mínimo, y límite de intentos de login por IP y por usuario.
20. **CSRF:** SameSite=Lax y cabecera `X-Requested-With` obligatoria en las peticiones que cambian datos.
21. **Roles:** guard de NestJS en cada endpoint según la tabla de permisos de `docs/03`. Cada endpoint de admin rechaza a un agente.
22. **Supabase:** Data API desactivada (o el esquema `app` sin exponer) y RLS sin políticas en todas las tablas. `service_role` solo en el servidor.
23. **Cabeceras:** helmet con CSP estricta (mismo origen).
24. **Datos personales:** solo los necesarios, con exportación y borrado de un contacto a petición (RGPD). Las acciones sensibles quedan en `AuditLog`.

## 7. Modelo de datos (`docs/05`)

25. `Contact.phoneE164` es único y se normaliza siempre antes de guardar (libphonenumber, país por defecto ES).
26. Hay una sola `Conversation` por contacto.
27. `Message.wamid` es único: un webhook repetido no duplica mensajes.
28. Los estados de un mensaje solo avanzan (SENT → DELIVERED → READ). Un estado tardío no retrocede, y FAILED gana a todo.
29. **Un contacto dado de baja nunca recibe marketing.** `consentStatus = REVOKED` excluye de cualquier campaña sin excepción. Solo se reactiva con un `ConsentEvent` que lleve origen y usuario. UNKNOWN y GRANTED reciben campañas.
30. Toda plantilla de marketing usada en campañas lleva el botón «No recibir más».
31. Los contadores de `Campaign` se recalculan desde `CampaignRecipient`, no solo con incrementos.
32. Borrar un contacto es un borrado lógico (`deletedAt`). El borrado físico es una acción de administradora y queda registrado en `AuditLog`.

## 8. Conocimiento y decisiones

33. Las decisiones importantes se anotan con fecha, opciones y motivo en `02-DOCS/wiki/harness/decisions.md`, y las que tome la sesión del MVP van también en su informe final (`docs/11`, sección 4). `docs/` no se modifica para reflejar decisiones del harness.

## Definición de terminado (contra lo que corre `verify`)

Se cumple `docs/08` («Definición de terminado») y, además:

- [ ] `pnpm build`, `pnpm test` y `pnpm test:e2e` en verde (principios 4-6).
- [ ] Trabajo en rama, con `main` intacta y trailers del entorno (9-10).
- [ ] Ni una sola llamada a Meta, Render o Supabase reales, y nada de `/register` (13-14).
- [ ] Sin secretos en el diff, y suelo de seguridad cumplido (16-24).
- [ ] Reglas del modelo cubiertas por pruebas, incluida la de REVOKED con selección manual (25-32).
- [ ] Decisiones anotadas (33).

## Registro de enmiendas (solo se añade)

| Fecha | Versión | Cambio | Motivo |
|-------|---------|--------|--------|
| 2026-11-05 | draft | Borrador generado por `rsc onboard`. | El suelo SDD necesita una constitución. |
| 2026-11-05 | v1.0.0 | Ratificada a partir de `CLAUDE.md`, `docs/04` y `docs/05`. | Encargo de Julio: completarla sin preguntas antes de cerrar la instalación del harness. |

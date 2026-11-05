# 12 · Kit de arranque: proyecto, repositorio, entorno y sesión

Todo lo necesario para lanzar la sesión autónoma de desarrollo. Valores listos para copiar.

## 1 · Proyecto de Claude (claude.ai)

Para las conversaciones sobre este cliente (orquestación, dudas, puesta en marcha), separado de CITAVELA.

| Campo | Valor |
| --- | --- |
| Nombre | `Gelado · Plataforma WhatsApp` |
| Descripción | `Plataforma propia de WhatsApp (sustituye a Superchat) para Exclusivas Gelado: bandeja, contactos, plantillas y campañas sobre la API oficial de Meta. Cliente de Julio, independiente de CITAVELA.` |
| Archivos de conocimiento | `CLAUDE.md` y todo `docs/` (00–12) |

**Instrucciones del proyecto** (pegar tal cual):

```text
Proyecto: plataforma de WhatsApp propia para Exclusivas Gelado (distribuidor de peluquería, barbería y estética), cliente de Julio. No tiene relación con CITAVELA.

Habla siempre en español.

Fuente de verdad: el repositorio privado gelado-whatsapp (cuenta de GitHub de Julio), carpeta docs/ y CLAUDE.md. Las respuestas del cliente están en docs/10_PREGUNTAS_ABIERTAS.md y mandan sobre el resto.

Forma de trabajar:
- El desarrollo se hace en sesiones autónomas en la nube con el RSC harness y una sola parada final. Todo bloque de instrucciones para un agente lleva modelo y esfuerzo de la sesión y de cada subagente, qué va en paralelo, revisión, correcciones y verificación final.
- Todo lo que se pueda hacer de forma autónoma lo hace Claude sin pasar por Julio. Solo pasan por Julio: credenciales, pagos, firmas, producción del cliente y lo irreversible.
- Optimizar el uso para terminar dentro del límite semanal del plan (modelos ligeros para picar código, el grande para orquestar y revisar).
- La interfaz se parece a Superchat a propósito: el equipo ya sabe usarlo.

Datos clave: número +34 617 49 82 22 · WABA 24936790469294569 · ID del número 833139829886325 · portfolio 115003938195726. Alojamiento en cuentas del cliente: Render (Hobby, credenciales del cliente) y Supabase (Pro). Sin dominio propio, sin correo saliente y sin 2FA en el MVP. Moneda EUR.
```

## 2 · Repositorio de GitHub

| Campo | Valor |
| --- | --- |
| Cuenta | La de Julio |
| Nombre | `gelado-whatsapp` |
| Visibilidad | **Privado** |
| Descripción | `Plataforma de WhatsApp de Exclusivas Gelado (bandeja, contactos, plantillas y campañas sobre la Cloud API de Meta)` |
| Rama por defecto | `main` (solo contiene la documentación inicial; no se trabaja directamente en ella) |
| Rama de trabajo de la sesión | `claude/mvp` (la crea la sesión; si el harness pone otro nombre, vale) |
| Contenido inicial | `CLAUDE.md`, `README.md`, `.gitignore`, `.env.example`, `scripts/setup-cloud.sh`, `docs/` (00–12 y `maquetas/`) |
| Integración | Al aprobar la entrega final, pull request de `claude/mvp` a `main`. Render despliega desde `main` |

Pasos: Julio crea el repositorio vacío (sin README) → Claude sube el contenido inicial a `main`.

## 3 · Entorno de la sesión en la nube (Claude Code)

| Campo | Valor |
| --- | --- |
| Nombre del entorno | `gelado-whatsapp` |
| Repositorio | `gelado-whatsapp` |
| Acceso a red | De confianza (registros de paquetes: npm, GitHub). Si Playwright no puede descargar su navegador, añadir su dominio de descargas o usar el Chromium del sistema |
| Script de configuración | `bash scripts/setup-cloud.sh` (probado el 05/11/2026: instala pnpm, PostgreSQL y crea la base `gelado` con el esquema `app`) |
| Variables de entorno | `NODE_ENV=development` · `TZ=Europe/Madrid` · `META_GRAPH_BASE_URL=http://localhost:4010` · `STORAGE_DRIVER=local`. **Ningún secreto real**: la sesión no los necesita |

Los nombres exactos de estos campos dependen de la pantalla de configuración de entornos; los valores son los mismos.

## 4 · Lanzar la sesión

1. Nueva sesión en la nube sobre el repositorio `gelado-whatsapp`, entorno `gelado-whatsapp`, rama base `main`.
2. Primer mensaje: el bloque de `docs/11_BLOQUE_INSTRUCCIONES_AGENTE.md` (de «ENCARGO» a la línea final), **pegado como texto**.
3. Modelo de la sesión: Opus 5.5 · esfuerzo high.
4. No hace falta nada más hasta la parada final.

## 5 · Después de la parada final

| Paso | Quién |
| --- | --- |
| Revisar el informe final y probar en el entorno temporal o local | Claude (resume y señala lo que necesita decisión) · Julio aprueba |
| Pull request `claude/mvp` → `main` | Claude |
| Puesta en marcha según `09` (Render, Supabase, Meta, importación, prueba real, retirada de Superchat) | Claude, salvo credenciales, tarjeta y firmas |

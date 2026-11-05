# Plataforma WhatsApp · Exclusivas Gelado — Documentación de desarrollo

Paquete preparado el 05/11/2026 a partir del briefing relleno por el cliente y de 37 capturas de su cuenta de Superchat.

**Qué se construye:** una plataforma web propia para que el equipo de Exclusivas Gelado (3 personas) atienda su WhatsApp desde el ordenador o el móvil y envíe campañas medibles a sus 6.560 contactos, sustituyendo a Superchat. Conectada a la API oficial de Meta con su número actual (+34 617 49 82 22), sin migrar ni volver a registrar el número.

## Índice

| Archivo | Contenido | Para quién |
| --- | --- | --- |
| `01_CONTEXTO_Y_DECISIONES.md` | Cliente, situación de WhatsApp, decisiones, costes, riesgos | Todos |
| `02_INVENTARIO_SUPERCHAT.md` | Qué hace hoy cada pantalla de Superchat y qué requisito sale | Referencia |
| `03_ESPECIFICACION_FUNCIONAL.md` | Requisitos por módulo con alcance (MVP / MVP-P / Fase 2), roles y reglas de negocio | Desarrollo |
| `04_ARQUITECTURA.md` | Componentes, colas, media, seguridad, entornos, cuentas | Desarrollo |
| `05_MODELO_DE_DATOS.md` | Esquema Prisma, datos iniciales y reglas del modelo | Desarrollo |
| `06_INTEGRACION_WHATSAPP.md` | Webhook, envíos, media, plantillas, límites, errores, costes, simulador | Desarrollo |
| `07_PANTALLAS.md` | Descripción de cada pantalla y su comportamiento | Desarrollo y maquetas |
| `08_PLAN_DE_ENTREGAS.md` | Fases internas, pruebas obligatorias, criterios de aceptación, definición de terminado | Desarrollo |
| `09_MIGRACION_Y_PUESTA_EN_MARCHA.md` | Pasos para dejar Superchat y arrancar, con quién hace cada uno | Julio, cliente, Claude |
| `10_PREGUNTAS_ABIERTAS.md` | Preguntas respondidas por Julio el 05/11/2026 (mandan sobre el resto) | Todos |
| `maquetas/` | Maquetas aprobadas de las pantallas, con la forma de trabajar de Superchat | Desarrollo |
| `12_ARRANQUE_SESION.md` | Proyecto de Claude, repositorio, rama, entorno en la nube y cómo lanzar la sesión | Julio |
| `../CLAUDE.md` | Contexto permanente para cualquier sesión de Claude en el repo | Claude |
| `11_BLOQUE_INSTRUCCIONES_AGENTE.md` | Texto para pegar en la sesión autónoma (RSC harness), con modelo y esfuerzo por subagente | Julio |

## Resumen en 6 líneas

1. **Stack:** React + Vite, NestJS, Prisma + PostgreSQL, cola en PostgreSQL (pg-boss). Un solo servicio en Render + Supabase (BD y archivos).
2. **Cuentas del cliente:** Render (workspace Hobby gratuito, servicio Starter 7 USD) y Supabase (Pro, 25 USD), pagadas y facturadas a su nombre; Julio gestiona con acceso. Meta ≈ 82 €/mes al ritmo actual.
3. **MVP:** bandeja compartida con ventana de 24 h, adjuntos (fotos, PDF, audios, notas de voz), biblioteca de catálogos, plantillas desde el chat; contactos con importación de los 6.560 y bajas automáticas; gestor de plantillas; campañas escalonadas con informe; calidad del número y costes.
4. **Fuera:** IA, otros canales, ERP/tienda, chat interno, verificación en dos pasos, dominio propio y correo saliente, reseñas de Google (hasta tener acceso a su API).
5. **Desarrollo:** una sola entrega autónoma en la nube con parada final; todo probado contra un simulador de Meta.
6. **Puesta en marcha:** se conecta la app nueva a la WABA del cliente, se prueba con el número real y solo entonces se retira a Superchat (tras poner la tarjeta del cliente en Meta).

## Siguiente paso

1. Exportar ya de Superchat contactos, PDF de la biblioteca e informes (`09`, bloque A) — Superchat aún deja entrar.
2. Aprobar las maquetas.
3. Crear el repositorio vacío `gelado-whatsapp` → Claude sube el contenido inicial → configurar el entorno y lanzar la sesión según `12`.

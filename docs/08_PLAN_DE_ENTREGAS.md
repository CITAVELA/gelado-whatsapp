# 08 · Plan de entrega y criterios de aceptación

**Una sola entrega autónoma** en una sesión en la nube (RSC harness), sin paradas intermedias. La única parada es la final, con todo construido, probado contra el simulador de Meta y desplegable. La conexión al número real y la retirada de Superchat se hacen después, siguiendo `09`.

Alcance: todo lo marcado **MVP** y **MVP-P** en `03` (las MVP-P quedaron confirmadas el 05/11/2026), con las decisiones de `10`.

## Fases internas (orden de construcción)

| Fase | Contenido | Hecho cuando… |
| --- | --- | --- |
| F0 · Base | Monorepo, NestJS + React/Vite, Prisma con el esquema de `05`, seed, auth y roles (invitación y nueva contraseña por enlace, sin correo), registro de actividad, simulador de Meta, health check, configuración de Render (`render.yaml`) | Login funciona; migraciones y seed limpios en BD vacía; `pnpm test` verde |
| F1 · WhatsApp núcleo | Webhook (verificación, firma, persistencia, cola), procesamiento de todos los tipos entrantes, envío de texto/media/plantilla, estados, descarga de media a Storage, notas de voz, marcar como leído, mapeo de errores | Todos los casos del simulador pasan (ver pruebas) |
| F2 · Bandeja | Vistas, pestañas, lista, conversación, compositor, ventana de 24 h, plantilla desde el chat, biblioteca, asignar, etiquetas, posponer, finalizar, estrella, no leído, notas, búsqueda, tiempo real, notificaciones, ficha lateral | Recorrido completo de un agente sin recargar la página |
| F3 · Contactos | Listado, filtros, ficha, importador (con el CSV real exportado de Superchat si está disponible; si no, uno sintético de 7.000 filas con los mismos problemas), exportar, etiquetas, consentimiento y bajas | Importa 7.000 filas en < 2 min con informe correcto |
| F4 · Plantillas | Sincronización, editor con vista previa, envío a Meta (incluida cabecera multimedia con Resumable Upload), estados por webhook | Crea y sincroniza en el simulador; las 12 actuales se ven bien |
| F5 · Campañas | Asistente, audiencia con exclusiones, prueba, programación, envío escalonado con límite de 24 h, pausar/reanudar/cancelar, parada automática, informe, exportación, duplicar | Campaña de 2.500 destinatarios con límite 2.000 se reparte en 2 días y el informe cuadra al 100 % |
| F6 · Calidad, costes y ajustes | Calidad y límite, alertas (banner en la app y `/api/status`), costes, horario, fuera de horario (encendido), vacaciones (apagado), equipo con enlaces de invitación y de nueva contraseña, etiquetas, tarifas | Alertas disparadas desde el simulador |
| F7 · Pulido y verificación final | Responsive móvil, accesibilidad básica, textos en español, revisión de seguridad, revisión de código independiente, documentación de operación | Lista de verificación final completa |

## Pruebas obligatorias

**Automáticas (Vitest/Jest + Supertest, Playwright para e2e contra el simulador):**

1. Webhook: firma válida/ inválida/ ausente; evento duplicado no duplica mensaje; estado que llega antes que la respuesta del envío; estados fuera de orden no retroceden.
2. Entrantes de todos los tipos de la tabla de `06`, incluido `unsupported`.
3. Media: descarga correcta; URL caducada → se pide de nuevo; tamaño/tipo no permitido → error claro.
4. Ventana de 24 h: texto bloqueado con ventana cerrada; 131047 gestionado.
5. Bajas: botón `OPT_OUT`, palabras clave, 131050, etiqueta heredada; un contacto REVOKED nunca entra en campaña (prueba con selección manual incluida).
6. Campañas: exclusiones, recuento, ritmo, límite diario y reparto, pausa/reanudación sin duplicados, cancelación, parada automática por 132015 y por 368, contadores recalculados.
7. Importación: teléfonos españoles en todos los formatos (`617498222`, `+34 617 49 82 22`, `0034…`), extranjeros, inválidos, duplicados, emojis en nombres, CIF en el campo DNI, filas vacías.
8. Permisos: cada endpoint de admin rechaza a un agente.
9. Respuesta fuera de horario: se envía una vez cada 12 h como máximo, respeta horario y vacaciones, zona Europe/Madrid (incluido cambio de hora).
10. Coste: cálculo a partir de `pricing` de los estados.

**Manuales en el informe final (con capturas):** recorrido de agente (recibir, responder con texto, PDF de la biblioteca, nota de voz, plantilla con ventana cerrada, asignar, etiquetar, posponer, finalizar) y recorrido de administradora (importar, crear plantilla, campaña de prueba, informe).

## Criterios de aceptación del cliente (para la puesta en marcha)

- Los 3 usuarios entran y ven todas las conversaciones.
- Un mensaje entrante aparece en menos de 5 s sin recargar, con aviso sonoro.
- Pueden responder con texto, catálogo PDF, foto y nota de voz, y el cliente lo recibe.
- Con la ventana cerrada solo pueden enviar plantilla, y funciona.
- Los 6.560 contactos están importados con sus etiquetas y las bajas respetadas.
- Una campaña real a una etiqueta pequeña (p. ej. Estética, 292) sale escalonada y el informe muestra entregados, leídos y respondidos.
- La calidad del número se ve en la app.

## Definición de terminado (parada final)

1. Todo el alcance de la tabla de fases hecho o, si algo no se pudo, explicado con motivo y propuesta.
2. Pruebas automáticas en verde; informe de cobertura de las 10 áreas anteriores.
3. Revisión de código independiente hecha y sus hallazgos corregidos.
4. Revisión de seguridad hecha (lista de `04`).
5. `README` de operación: variables de entorno, despliegue en Render, cómo rotar el token de Meta, cómo restaurar una copia.
6. Despliegue preparado (`render.yaml`, variables listadas sin valores) y probado en un entorno temporal o en local con Docker.
7. Informe final breve en español: qué hay, cómo probarlo, qué queda pendiente y qué necesita de Julio o del cliente.

# 01 · Contexto y decisiones

## El cliente

| Campo | Valor |
| --- | --- |
| Empresa | Exclusivas Gelado (Exclusivas Gelado SL) — distribuidor de productos de peluquería, barbería y estética |
| Contacto y decisores | Manuel Gelado (contacto) · Manuel Gelado y María (aprueban) |
| Usuarios de la plataforma | María Iborra (admin), Cristina Lopez, Lolo Gelado |
| Clientes finales | Sobre todo profesionales: peluquerías (1.522), barberías (353), estética (292), institutos; 6.560 contactos en total |
| Horario | L–V 09:00–14:00 y 17:00–20:00 · S 09:30–13:30 |

## Situación de WhatsApp (comprobada el 05/11/2026)

| Dato | Valor |
| --- | --- |
| Número | +34 617 49 82 22 · nombre visible «Exclusivas Gelado» |
| Portfolio (Business Manager) | 115003938195726 — **propiedad del cliente** |
| Cuenta de WhatsApp (WABA) | 24936790469294569 — propiedad del cliente |
| ID del número | 833139829886325 |
| Estado | Conectado · calidad Alta · límite 2.000 usuarios únicos / 24 h |
| Uso 8 oct – 4 nov 2026 | 1.841 enviados (1.394 marketing, 293 servicio) · 1.687 entregados · 690 recibidos |
| Pago a Meta hoy | Línea de crédito de Superchat (SuperX GmbH). **Falta poner la tarjeta del cliente** antes de quitar a Superchat |
| App de WhatsApp del móvil | No funciona con este número: está en la API. La plataforma nueva es la única forma de leer y responder |

El número **no se migra ni se vuelve a registrar**: se conecta una app de Meta nueva del cliente a su WABA y después se retira a Superchat (ver `09_MIGRACION_Y_PUESTA_EN_MARCHA.md`).

## Decisiones tomadas

| # | Decisión | Motivo |
| --- | --- | --- |
| D1 | Plataforma **propia**, sin software de terceros (nada de Chatwoot ni similares) | No depender de terceros |
| D2 | **Solo para este cliente** (una instancia, sin multiempresa) | No se va a vender a otros distribuidores |
| D3 | Stack igual que CITAVELA: **React + Vite + TypeScript** (web), **NestJS** (API y worker), **Prisma + PostgreSQL** | Stack conocido por el equipo y por los agentes |
| D4 | **Alojamiento en cuentas del cliente, pagadas por él con su método de pago y facturadas a su nombre** (él las declara). Julio gestiona todo con acceso a esas cuentas | Fiscal: Julio no refactura hosting ni hace papeleo extra; sale más barato al cliente |
| D5 | Render: **workspace del cliente en plan Hobby (gratuito)**; Julio entra con las credenciales que le da el cliente (trabaja la mayor parte del tiempo en su oficina). El plan Hobby no admite invitar a otro miembro, por eso no se invita | Evitar el plan Pro de Render (25 $/mes fijos solo por poder invitar) |
| D6 | Supabase: **organización del cliente en plan Pro** (sin pausas, copias diarias, 8 GB de base de datos y 100 GB de archivos); Julio invitado como miembro o con las credenciales del cliente | El plan gratuito se pausa por inactividad, no tiene copias y solo da 1 GB de archivos (los adjuntos lo superan) |
| D7 | Región UE (Frankfurt) en Render y Supabase | RGPD; igual que Superchat |
| D8 | Meta: la app, el usuario de sistema y el token se crean en el **Business Manager del cliente** | Todo queda a su nombre |
| D9 | Sin IA ni automatizaciones complejas en esta versión | Pedido por el cliente |
| D10 | Interfaz en español; responsive para usarla también desde el navegador del móvil; sin app nativa | El cliente trabaja sobre todo en ordenador; «App web» |
| D11 | **Interfaz parecida a Superchat** en distribución, nombres y flujos, con la marca de Gelado | El equipo ya sabe usar Superchat; no quieren aprender de cero |
| D12 | Sin dominio propio (dirección gratuita de Render), sin correo saliente y sin verificación en dos pasos en el MVP | Arrancar lo antes posible |
| D13 | Todo contacto no dado de baja recibe marketing; botón «No recibir más» obligatorio en cada campaña | Decisión del cliente; la LSSI exige la baja sencilla en cada comunicación comercial |
| D14 | Maquetas aprobadas antes del desarrollo; luego una sola entrega autónoma en la nube (RSC harness) con parada final | Forma de trabajo de Julio |

## Costes mensuales que paga el cliente directamente

| Concepto | Proveedor | Importe aproximado |
| --- | --- | --- |
| Servicio web (API + worker) | Render · instancia Starter | 7 USD |
| Web (frontend) | Render · sitio estático | 0 USD |
| Base de datos, archivos y copias | Supabase · Pro (incluye 10 USD de crédito que cubren la instancia Micro) | 25 USD |
| Mensajes de WhatsApp | Meta · por plantilla entregada | ≈ 82 € (1.394 marketing × 0,0585 €; servicio gratis hasta 1.000/mes) |
| **Total** | | **≈ 32 USD + ≈ 82 € al mes, más IVA donde aplique** |

Superchat costaba un plan desde 79 €/mes más complementos y, además, los mensajes de Meta.

> Precios de proveedores a 05/11/2026; comprobar antes de presupuestar. Los honorarios de Julio (desarrollo y mantenimiento) van aparte y no incluyen el alojamiento.

## Riesgos principales

| Riesgo | Mitigación |
| --- | --- |
| Sin correo, si un usuario olvida la contraseña depende de María | María genera el enlace en 10 s desde Ajustes → Equipo |
| Quedarse sin envíos al retirar a Superchat (su línea de crédito paga hoy los mensajes) | Tarjeta del cliente en Meta **antes** de quitar a Superchat |
| Nuevo bloqueo del número por quejas de spam | Bajas automáticas, consentimiento registrado, envío escalonado, aviso de calidad |
| Credenciales compartidas de Render | Gestor de contraseñas, 2FA del cliente con método que controle él, cambio de contraseña al terminar la relación |
| Acceso a la API de Google Business Profile (reseñas) | Fuera del MVP hasta tener acceso aprobado |
| Datos de contactos sucios (nombres con emojis, CIF en DNI) | Importador con normalización e informe de errores |

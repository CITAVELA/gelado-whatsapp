# 09 · Migración desde Superchat y puesta en marcha

Quién hace cada paso:

- **Cliente**: solo él puede hacerlo (su tarjeta, sus cuentas, su firma).
- **Julio**: hace falta su presencia o su usuario (credenciales, oficina del cliente, aceptar invitaciones).
- **Claude**: lo hace Claude de forma autónoma, sin pasar por Julio, con los conectores (Meta, Supabase), el navegador de la app de escritorio o la sesión de desarrollo.

Regla: Claude hace todo lo que no necesite una credencial, un pago o una firma. Los pasos marcados ⚠️ son irreversibles o afectan al servicio y van en el orden indicado.

## A · Ya, antes de desarrollar (urgente)

Superchat **todavía deja entrar** (capturas del 05/11/2026), pero la suscripción ha terminado y puede cerrarse en cualquier momento.

| # | Paso | Quién |
| --- | --- | --- |
| A1 | En Superchat → Contactos → **Exportar todo** (CSV con atributos, listas y etiquetas). Guardar también una exportación por lista (Barbería, Estética, Peluquería) por si la general no trae las listas | Julio (en la oficina) |
| A2 | Descargar todos los PDF de Ajustes → **Archivos** (carpeta Catálogos) | Julio |
| A3 | Hacer captura o copiar el texto de las 12 plantillas y de las automatizaciones (las plantillas siguen en Meta, pero conviene tenerlo) | Julio |
| A4 | Exportar los informes de las campañas recientes (botón de descarga del detalle) | Julio |
| A5 | **Añadir la tarjeta del cliente** en Meta → Configuración del negocio → Facturación y pagos → cuenta de mensajes «Exclusivas Gelado», y dejarla como predeterminada si Meta lo permite | Cliente |
| A6 | Moneda de la cuenta de WhatsApp: **EUR** (J3) | — |
| A7 | Invitar a Julio al portfolio de Meta (115003938195726) con **control total** | Cliente + Julio acepta |
| A8 | Pedir acceso a la API de Google Business Profile para las reseñas (P5), con la cuenta de Google que gestiona el perfil «Exclusivas Gelado SL» | Claude prepara la solicitud · el titular del perfil la envía |

## B · Cuentas del cliente (antes o durante el desarrollo)

| # | Paso | Quién |
| --- | --- | --- |
| B1 | Crear la cuenta de **Supabase** con un correo del cliente; organización «Exclusivas Gelado», plan **Pro**, tarjeta y **datos fiscales del cliente** (dirección y CIF) para que la factura salga a su nombre | Cliente con Julio |
| B2 | Invitar a Julio como miembro (Owner/Admin) de la organización de Supabase | Cliente + Julio acepta |
| B3 | Crear el proyecto (región **Frankfurt**), desactivar la Data API, crear el esquema `app` y el bucket privado `media`, generar las cadenas de conexión del pooler en modo sesión | Claude (conector de Supabase, una vez Julio sea miembro) |
| B4 | Crear la cuenta de **Render** del cliente (workspace Hobby, gratuito), con su tarjeta y sus datos fiscales; guardar las credenciales en un gestor de contraseñas compartido; 2FA con un método que controle el cliente y que Julio pueda usar en la oficina | Cliente con Julio |
| B5 | Dirección web: la gratuita de Render (`*.onrender.com`), sin dominio propio en el MVP (P12) | — |
| B6 | Sin correo saliente en el MVP (P13) | — |
| B7 | Borrador del **contrato de encargado del tratamiento** (Julio ↔ Exclusivas Gelado) y del texto de política de privacidad que pide Meta (texto hecho: `docs/legal/politica-privacidad.md`; falta el contrato) | Claude redacta · Julio y cliente firman |
| B8 | Repositorio privado `gelado-whatsapp` en la cuenta de GitHub de Julio, con `/docs` y `/docs/maquetas` | Julio lo crea vacío · Claude sube la documentación |

## C · App de Meta del cliente

| # | Paso | Quién |
| --- | --- | --- |
| C1 | Crear la app de Meta en el portfolio del cliente, tipo Business, con el caso de uso de WhatsApp | Claude (conector Meta Social Technologies, con el usuario de Julio ya invitado) |
| C2 | Crear el **usuario de sistema** (administrador), asignarle la WABA con control total y la app, y generar el **token permanente** con `whatsapp_business_messaging` y `whatsapp_business_management` | Claude con el navegador de la app de escritorio si la sesión de Julio en Meta está abierta; si no, Julio (5 min) |
| C3 | Guardar App ID, App Secret y token como variables secretas en Render (nunca en el repo ni en el chat) | Claude si tiene acceso a Render; si no, Julio |
| C4 | Probar la app con el **número de prueba de Meta** (sin tocar el número real) | Sesión de desarrollo / Claude |

## D · Puesta en marcha (orden obligatorio)

| # | Paso | Quién |
| --- | --- | --- |
| D1 | Desplegar en Render (servicio web Starter, región Frankfurt), migraciones y seed, en la dirección `*.onrender.com` | Claude |
| D2 | Importar **primero la exportación general** de Superchat (A1, 6.560 contactos; los que no tienen móvil entran como «Sin WhatsApp»), **después las tres listas** (Peluquería, Barbería, Estética), cada una con «Añadir etiqueta» (la de su lista) y «Si existe: actualizar»; importar los PDF de la biblioteca (A2). Julio revisa con María el informe de avisos (país distinto de España, fijos españoles, teléfonos corregidos a +34, incompletos, sin WhatsApp) antes de seguir | Claude · Julio revisa el informe con María |
| D3 | Generar los enlaces de invitación de los 3 usuarios; cada uno crea su contraseña | Claude genera · Julio los pasa en la oficina |
| D4 | ⚠️ **Suscribir la app nueva a la WABA** (`POST /24936790469294569/subscribed_apps`) y configurar el webhook. Desde aquí llegan los mensajes también a la plataforma nueva | Claude |
| D5 | Prueba real: Julio escribe desde su móvil al +34 617 49 82 22 y responde desde la plataforma (texto, PDF, nota de voz, plantilla) | Julio + Claude |
| D6 | Rellenar en Ajustes → Privacidad los datos entre corchetes (CIF, domicilio, correo, fecha). En la configuración básica de la app de Meta, poner como URL de la política de privacidad `https://<servicio>.onrender.com/privacidad` y como URL de instrucciones de supresión de datos `…/privacidad#supresion`. Después, pasar la app a modo **Live** | Cliente da los datos · Claude el resto |
| D7 | Formación de 30 min a María, Cristina y Lolo (bandeja, plantillas, campañas, bajas) | Julio (en la oficina); Claude prepara una guía de una página |
| D7b | Duplicar las plantillas de campaña actuales (las de la carpeta CAMPAÑAS) añadiendo el botón «No recibir más» y enviarlas a revisión de Meta | Claude |
| D8 | Campaña real pequeña de prueba (etiqueta Estética, 292) con una plantilla con botón de baja, y revisión del informe | María con Julio |
| D9 | ⚠️ Comprobar que el método de pago del cliente está activo en Meta y **quitar a Superchat** de Socios del portfolio (retira su línea de crédito) | Cliente o Julio |
| D10 | ⚠️ Cambiar el **PIN de verificación en dos pasos** del número en WhatsApp Manager y guardarlo en el gestor de contraseñas | Julio |
| D11 | Vigilancia 7 días: calidad, errores, entregas, cupo de servicio, gasto | Claude (revisión diaria; avisa a Julio solo si algo falla) |

## Vuelta atrás

- Hasta D9, Superchat sigue conectado a la WABA; si la plataforma falla, se desuscribe la app nueva y no se pierde nada.
- Después de D9 no hay vuelta a Superchat (suscripción terminada). Por eso D5–D8 deben estar bien antes.

# 05 · Modelo de datos

Esquema Prisma de partida. El agente puede ajustar nombres y tipos, pero debe mantener las **reglas** del final del documento. Las tablas van en el esquema `app` de PostgreSQL (`?schema=app` en `DATABASE_URL`), no en `public`.

## Diagrama resumido

```
User ─┬─< Session
      ├─< Message (sentBy)         Contact ──1:1── Conversation ─┬─< Message ──> MediaFile
      ├─< Conversation (assignee)     │                          ├─< ConversationEvent
      └─< AuditLog                    ├─< ContactLabel >─ Label ─< ConversationLabel
                                      ├─< ConsentEvent
Template ─< Campaign ─< CampaignRecipient >── Contact
LibraryFolder ─< LibraryFile ──> MediaFile          WebhookEvent · QualitySnapshot · Setting · ImportJob
```

## schema.prisma (orientativo)

Validado con el validador oficial de Prisma (0 errores) el 05/11/2026.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  // Prisma 7+: las URLs van en prisma.config.ts (DATABASE_URL = pooler de Supabase en modo sesión, ?schema=app)
  // y el cliente usa el adaptador @prisma/adapter-pg. Si se usa la misma versión de Prisma que CITAVELA
  // y es anterior a la 7, poner aquí url = env("DATABASE_URL") y directUrl = env("DIRECT_URL").
}

// ───────────── Usuarios y acceso ─────────────

enum Role {
  ADMIN
  AGENT
}

model User {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @unique
  name         String
  passwordHash String
  role         Role      @default(AGENT)
  active       Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  sessions            Session[]
  resetTokens         PasswordResetToken[]
  assignedChats       Conversation[]       @relation("Assignee")
  sentMessages        Message[]            @relation("SentBy")
  events              ConversationEvent[]
  campaignsCreated    Campaign[]           @relation("CampaignCreatedBy")
  campaignsDeclared   Campaign[]           @relation("CampaignConsentBy")
  auditLogs           AuditLog[]
}

model Session {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @db.Uuid
  tokenHash  String   @unique
  expiresAt  DateTime
  lastSeenAt DateTime @default(now())
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model PasswordResetToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ───────────── Contactos ─────────────

enum ConsentStatus {
  UNKNOWN   // importado sin constancia: recibe marketing salvo baja (P6)
  GRANTED   // consentimiento registrado
  REVOKED   // baja: nunca recibe marketing
}

enum ConsentSource {
  IMPORT
  MANUAL
  WHATSAPP_BUTTON     // pulsó «No recibir más» / botón de alta
  WHATSAPP_KEYWORD    // escribió BAJA / STOP
  META_ERROR_131050   // Meta indica que el usuario paró el marketing
  LEGACY_LABEL        // etiqueta NO PUBLICIDAD de Superchat
  CAMPAIGN_DECLARATION
}

model Contact {
  id             String        @id @default(uuid()) @db.Uuid
  phoneE164      String?       @unique          // +34617498222; null = «Sin WhatsApp» (P16); varios NULL permitidos
  waId           String?       @unique          // wa_id que manda Meta
  firstName      String?
  lastName       String?
  profileName    String?                        // nombre de perfil de WhatsApp (solo lectura)
  email          String?
  company        String?
  customerCode   String?                        // «Código» de Superchat (texto para no perder ceros)
  taxId          String?                        // «DNI» de Superchat (DNI o CIF)
  landline       String?                        // «Teléfono fijo»
  notes          String?
  consentStatus  ConsentStatus @default(UNKNOWN)
  consentAt      DateTime?
  phoneInvalid   Boolean       @default(false)  // 131026 repetido / no tiene WhatsApp
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  deletedAt      DateTime?

  labels         ContactLabel[]
  conversation   Conversation?
  consentEvents  ConsentEvent[]
  campaignSends  CampaignRecipient[]

  @@index([customerCode])
  @@index([taxId])
  @@index([consentStatus])
}

model ConsentEvent {
  id        String        @id @default(uuid()) @db.Uuid
  contactId String        @db.Uuid
  status    ConsentStatus
  source    ConsentSource
  note      String?
  userId    String?       @db.Uuid
  messageId String?       @db.Uuid
  createdAt DateTime      @default(now())
  contact   Contact       @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId, createdAt])
}

enum LabelScope {
  CONTACT        // tipo de cliente: PELUQUERÍA, BARBERÍA, ESTÉTICA…
  CONVERSATION   // tema: PEDIDO, FACTURA, TRANSPORTE…
}

model Label {
  id              String     @id @default(uuid()) @db.Uuid
  name            String
  color           String     // hex
  scope           LabelScope
  showAsInboxView Boolean    @default(false)   // aparece como «bandeja» en el menú lateral
  sortOrder       Int        @default(0)
  createdAt       DateTime   @default(now())

  contacts        ContactLabel[]
  conversations   ConversationLabel[]

  @@unique([name, scope])
}

model ContactLabel {
  contactId String   @db.Uuid
  labelId   String   @db.Uuid
  createdAt DateTime @default(now())
  contact   Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  label     Label    @relation(fields: [labelId], references: [id], onDelete: Cascade)

  @@id([contactId, labelId])
  @@index([labelId])
}

// ───────────── Bandeja ─────────────

enum ConversationStatus {
  OPEN
  SNOOZED
  DONE
}

model Conversation {
  id                    String             @id @default(uuid()) @db.Uuid
  contactId             String             @unique @db.Uuid
  status                ConversationStatus @default(OPEN)
  snoozedUntil          DateTime?
  assigneeId            String?            @db.Uuid
  starred               Boolean            @default(false)
  unreadCount           Int                @default(0)
  lastMessageAt         DateTime?
  lastMessagePreview    String?
  lastInboundAt         DateTime?          // abre/renueva la ventana de 24 h
  windowExpiresAt       DateTime?          // lastInboundAt + 24 h
  lastAutoReplyAt       DateTime?          // fuera de horario / vacaciones
  lastCampaignId        String?            @db.Uuid
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt

  contact   Contact             @relation(fields: [contactId], references: [id], onDelete: Cascade)
  assignee  User?               @relation("Assignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  messages  Message[]
  events    ConversationEvent[]
  labels    ConversationLabel[]

  @@index([status, lastMessageAt])
  @@index([assigneeId, status])
  @@index([snoozedUntil])
}

model ConversationLabel {
  conversationId String       @db.Uuid
  labelId        String       @db.Uuid
  createdAt      DateTime     @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  label          Label        @relation(fields: [labelId], references: [id], onDelete: Cascade)

  @@id([conversationId, labelId])
}

enum MessageDirection {
  INBOUND
  OUTBOUND
  INTERNAL    // nota interna: nunca sale a WhatsApp
}

enum MessageKind {
  TEXT
  IMAGE
  AUDIO
  VOICE
  VIDEO
  DOCUMENT
  STICKER
  LOCATION
  CONTACTS
  BUTTON_REPLY      // respuesta a botón de plantilla o interactivo
  REACTION
  TEMPLATE
  AUTO_REPLY        // fuera de horario / vacaciones
  NOTE
  UNSUPPORTED
}

enum MessageStatus {
  RECEIVED          // entrante
  PENDING           // en cola para enviar
  SENT
  DELIVERED
  READ
  FAILED
}

model Message {
  id                String           @id @default(uuid()) @db.Uuid
  conversationId    String           @db.Uuid
  direction         MessageDirection
  kind              MessageKind
  body              String?          // texto o pie de foto
  mediaId           String?          @db.Uuid
  templateId        String?          @db.Uuid
  templateParams    Json?            // valores enviados en cada componente
  payload           Json?            // ubicación, contactos, botón pulsado, reacción…
  wamid             String?          @unique
  contextWamid      String?          // mensaje citado
  status            MessageStatus
  errorCode         Int?
  errorTitle        String?
  errorDetails      String?
  sentOutsideWindow Boolean          @default(false) // cuenta para el límite de 24 h
  pricingCategory   String?          // marketing, utility, service… (de los estados de Meta)
  billable          Boolean?
  sentById          String?          @db.Uuid
  campaignId        String?          @db.Uuid
  receivedAt        DateTime?
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  failedAt          DateTime?
  raw               Json?            // objeto original de Meta (entrantes)
  createdAt         DateTime         @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  media        MediaFile?   @relation(fields: [mediaId], references: [id])
  template     Template?    @relation(fields: [templateId], references: [id])
  sentBy       User?        @relation("SentBy", fields: [sentById], references: [id], onDelete: SetNull)
  campaign     Campaign?    @relation(fields: [campaignId], references: [id])
  recipient    CampaignRecipient?

  @@index([conversationId, createdAt])
  @@index([campaignId])
  @@index([direction, kind, sentAt])
}

enum ConversationEventType {
  ASSIGNED
  UNASSIGNED
  SNOOZED
  WOKE_UP
  DONE
  REOPENED
  LABEL_ADDED
  LABEL_REMOVED
  STARRED
  UNSTARRED
  CONSENT_CHANGED
}

model ConversationEvent {
  id             String                @id @default(uuid()) @db.Uuid
  conversationId String                @db.Uuid
  type           ConversationEventType
  actorId        String?               @db.Uuid      // null = sistema
  data           Json?
  createdAt      DateTime              @default(now())
  conversation   Conversation          @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  actor          User?                 @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([conversationId, createdAt])
}

// ───────────── Archivos ─────────────

enum MediaSource {
  INBOUND
  UPLOAD
  LIBRARY
  TEMPLATE_EXAMPLE
}

model MediaFile {
  id                 String      @id @default(uuid()) @db.Uuid
  storagePath        String      @unique
  mimeType           String
  sizeBytes          Int
  fileName           String?
  sha256             String?
  source             MediaSource
  waMediaId          String?     // id en WhatsApp para reutilizar
  waMediaIdExpiresAt DateTime?
  createdById        String?     @db.Uuid
  createdAt          DateTime    @default(now())

  messages     Message[]
  libraryFiles LibraryFile[]
}

model LibraryFolder {
  id        String          @id @default(uuid()) @db.Uuid
  name      String
  parentId  String?         @db.Uuid
  sortOrder Int             @default(0)
  parent    LibraryFolder?  @relation("FolderTree", fields: [parentId], references: [id])
  children  LibraryFolder[] @relation("FolderTree")
  files     LibraryFile[]
}

model LibraryFile {
  id          String         @id @default(uuid()) @db.Uuid
  folderId    String?        @db.Uuid
  name        String                       // «DOUSSE Carta de Color»
  mediaFileId String         @db.Uuid
  createdById String?        @db.Uuid
  createdAt   DateTime       @default(now())
  folder      LibraryFolder? @relation(fields: [folderId], references: [id])
  media       MediaFile      @relation(fields: [mediaFileId], references: [id])
}

// ───────────── Plantillas y campañas ─────────────

enum TemplateCategory {
  MARKETING
  UTILITY
  AUTHENTICATION
}

enum TemplateStatus {
  LOCAL_DRAFT
  PENDING
  APPROVED
  REJECTED
  PAUSED
  DISABLED
  IN_APPEAL
  DELETED
}

model Template {
  id              String           @id @default(uuid()) @db.Uuid
  metaTemplateId  String?          @unique
  name            String                       // nombre en Meta (minúsculas y _)
  displayName     String?                      // nombre interno legible
  language        String                       // es
  category        TemplateCategory
  status          TemplateStatus
  components      Json                         // HEADER/BODY/FOOTER/BUTTONS tal cual Meta
  rejectedReason  String?
  qualityScore    String?
  hasOptOutButton Boolean          @default(false)
  lastSyncedAt    DateTime?
  createdById     String?          @db.Uuid
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  messages  Message[]
  campaigns Campaign[]

  @@unique([name, language])
}

enum CampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
  CANCELLED
  FAILED
}

model Campaign {
  id                   String         @id @default(uuid()) @db.Uuid
  name                 String
  templateId           String         @db.Uuid
  variableMapping      Json           // { "body.1": { "field": "firstName", "fallback": "cliente" }, … }
  headerMediaId        String?        @db.Uuid
  audience             Json           // { includeLabelIds: [], excludeLabelIds: [], includeUnknownConsent: false }
  status               CampaignStatus @default(DRAFT)
  scheduledAt          DateTime?
  startedAt            DateTime?
  completedAt          DateTime?
  ratePerMinute        Int            @default(20)
  stopReason           String?
  consentDeclared      Boolean        @default(false)
  consentDeclaredById  String?        @db.Uuid
  consentDeclaredAt    DateTime?
  estimatedCost        Decimal?       @db.Decimal(10, 4)
  currency             String         @default("EUR")
  totalRecipients      Int            @default(0)
  sentCount            Int            @default(0)
  deliveredCount       Int            @default(0)
  readCount            Int            @default(0)
  repliedCount         Int            @default(0)
  failedCount          Int            @default(0)
  skippedCount         Int            @default(0)
  optOutCount          Int            @default(0)
  createdById          String         @db.Uuid
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt

  template     Template            @relation(fields: [templateId], references: [id])
  createdBy    User                @relation("CampaignCreatedBy", fields: [createdById], references: [id])
  consentBy    User?               @relation("CampaignConsentBy", fields: [consentDeclaredById], references: [id])
  recipients   CampaignRecipient[]
  messages     Message[]

  @@index([status, scheduledAt])
}

enum RecipientStatus {
  QUEUED
  SENDING
  SENT
  DELIVERED
  READ
  FAILED
  SKIPPED
}

model CampaignRecipient {
  id           String          @id @default(uuid()) @db.Uuid
  campaignId   String          @db.Uuid
  contactId    String          @db.Uuid
  phoneE164    String?                      // copia en el momento del envío (null = Sin WhatsApp)
  status       RecipientStatus @default(QUEUED)
  skipReason   String?                      // REVOKED, UNKNOWN_CONSENT, PHONE_INVALID, NO_PHONE, DAILY_LIMIT, DUPLICATE
  plannedFor   DateTime?                    // tanda / día previsto
  messageId    String?         @unique @db.Uuid
  errorCode    Int?
  errorTitle   String?
  sentAt       DateTime?
  deliveredAt  DateTime?
  readAt       DateTime?
  repliedAt    DateTime?
  optedOutAt   DateTime?

  campaign Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact  Contact  @relation(fields: [contactId], references: [id])
  message  Message? @relation(fields: [messageId], references: [id])

  @@unique([campaignId, contactId])
  @@index([campaignId, status])
}

// ───────────── Sistema ─────────────

model WebhookEvent {
  id             String    @id @default(uuid()) @db.Uuid
  receivedAt     DateTime  @default(now())
  signatureValid Boolean
  field          String?                     // messages, message_template_status_update…
  dedupeKey      String?   @unique           // wamid+status, id de evento…
  payload        Json
  processedAt    DateTime?
  attempts       Int       @default(0)
  error          String?

  @@index([processedAt])
}

model QualitySnapshot {
  id             String   @id @default(uuid()) @db.Uuid
  qualityRating  String                      // GREEN, YELLOW, RED, UNKNOWN
  messagingLimit String?
  phoneStatus    String?
  source         String                      // POLL | WEBHOOK
  raw            Json?
  createdAt      DateTime @default(now())
}

model Setting {
  key         String   @id                   // business_hours, out_of_hours, vacation, rates, campaign_defaults, privacy_policy
  value       Json
  updatedById String?  @db.Uuid
  updatedAt   DateTime @updatedAt
}

model ImportJob {
  id          String    @id @default(uuid()) @db.Uuid
  fileName    String
  mediaFileId String    @db.Uuid
  mapping     Json?
  status      String                          // UPLOADED, PREVIEWED, RUNNING, DONE, FAILED
  totalRows   Int       @default(0)
  created     Int       @default(0)
  updated     Int       @default(0)
  skipped     Int       @default(0)
  errors      Json?                           // [{ row, reason }]
  createdById String    @db.Uuid
  createdAt   DateTime  @default(now())
  finishedAt  DateTime?
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String?  @db.Uuid
  action     String                           // export_contacts, launch_campaign, delete_contact…
  entityType String?
  entityId   String?
  data       Json?
  ip         String?
  createdAt  DateTime @default(now())
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([createdAt])
}
```

Índice de búsqueda (migración SQL manual): columna generada `tsvector` en español sobre `Message.body` con índice GIN, más índices trigram (`pg_trgm`) en nombre, teléfono, código y CIF del contacto.

## Datos iniciales (seed)

| Qué | Valores |
| --- | --- |
| Usuarios | María Iborra (ADMIN), Cristina Lopez (AGENT), Lolo Gelado (AGENT); se crean con **enlace de invitación** de un solo uso (sin correo), sin contraseña fija |
| Etiquetas de contacto (`showAsInboxView = true`) | PELUQUERÍA (azul), BARBERÍA (rojo), ESTÉTICA (verde), INSTITUTO (amarillo), JUBILADO (gris) |
| Etiquetas de conversación | PEDIDO (verde oscuro), FACTURA (naranja), TRANSPORTE (azul oscuro) |
| NO PUBLICIDAD | **No se crea como etiqueta**: al importar, quien la tenga pasa a `consentStatus = REVOKED` con origen `LEGACY_LABEL` |
| `business_hours` | L–V 09:00–14:00 y 17:00–20:00; S 09:30–13:30; D cerrado; Europe/Madrid |
| `out_of_hours` | **Activado** (P3); texto = el de la plantilla «Cierre de Ventana 24h» con 3 botones acortados a 20 caracteres («Hacer un pedido», «Necesito factura», «Duda o consulta»); `vacation` desactivado |
| `rates` | Moneda **EUR** (J3) · marketing 0,0585 · utility 0,0166 · authentication 0,0166 · service 0,0166 tras 1.000 gratis/mes (España, 05/11/2026) |
| `privacy_policy` | `{ markdown, updatedAt }` con el contenido de `docs/legal/politica-privacidad.md` (sin el comentario inicial). El seed no lo pisa si ya existe |
| `campaign_defaults` | ratePerMinute 20 · todo contacto no REVOKED recibe campañas (P6) · plantilla de marketing con botón de baja obligatoria · límite diario 2.000 (se actualiza desde Meta) |

## Reglas que el modelo debe garantizar

1. **Si hay teléfono**, `Contact.phoneE164` es E.164 y único; normalizar siempre antes de guardar (libphonenumber, país por defecto ES). `phoneE164` puede ser NULL (contacto «Sin WhatsApp», P16): la BD exige teléfono, correo o código (`CHECK "Contact_identity_check"`) y el alta manual exige teléfono o correo. Un contacto sin teléfono no tiene `Conversation` ni recibe campañas (`skipReason = NO_PHONE`). Índice `lower("email")` para deduplicar la importación por correo.
2. Una sola `Conversation` por contacto.
3. `Message.wamid` único: un webhook repetido no duplica mensajes.
4. Los estados de un mensaje solo avanzan (SENT → DELIVERED → READ); un estado que llega tarde no hace retroceder. FAILED gana a todo.
5. `consentStatus = REVOKED` excluye de cualquier campaña sin excepción, y no se puede volver a activar sin un `ConsentEvent` con origen y usuario. UNKNOWN y GRANTED reciben campañas.
6. Los contadores de `Campaign` se recalculan desde `CampaignRecipient` (no solo incrementos), para que el informe cuadre siempre.
7. Borrar un contacto es borrado lógico (`deletedAt`); el borrado físico es una acción de administradora con registro en `AuditLog` (derecho de supresión).

// Tipos de la Graph API de WhatsApp (Cloud API) que usa la app. Ver docs/06.

export interface WaSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

export interface WaGraphError {
  message: string;
  type?: string;
  code: number;
  error_subcode?: number;
  error_data?: { messaging_product?: string; details?: string };
  fbtrace_id?: string;
}

export type WaOutboundMessage =
  | { type: 'text'; text: { body: string; preview_url?: boolean } }
  | { type: 'image'; image: { id?: string; link?: string; caption?: string } }
  | { type: 'video'; video: { id?: string; link?: string; caption?: string } }
  | { type: 'audio'; audio: { id?: string; link?: string } }
  | { type: 'document'; document: { id?: string; link?: string; caption?: string; filename?: string } }
  | { type: 'sticker'; sticker: { id: string } }
  | { type: 'template'; template: { name: string; language: { code: string }; components?: WaTemplateSendComponent[] } }
  | { type: 'interactive'; interactive: WaInteractive }
  | { type: 'reaction'; reaction: { message_id: string; emoji: string } };

export interface WaTemplateSendComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: string;
  parameters: Array<
    | { type: 'text'; text: string }
    | { type: 'payload'; payload: string }
    | { type: 'image'; image: { id?: string; link?: string } }
    | { type: 'video'; video: { id?: string; link?: string } }
    | { type: 'document'; document: { id?: string; link?: string; filename?: string } }
  >;
}

export interface WaInteractive {
  type: 'button';
  body: { text: string };
  footer?: { text: string };
  action: { buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }> };
}

export interface WaMediaInfo { url: string; mime_type: string; sha256: string; file_size: number; id: string; messaging_product: 'whatsapp' }

export interface WaTemplate {
  id: string;
  name: string;
  status: string;            // APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL, DELETED…
  category: string;          // MARKETING, UTILITY, AUTHENTICATION
  language: string;
  components: import('./templates').TemplateComponent[];
  quality_score?: { score: string; date?: number };
  rejected_reason?: string;
}

export interface WaPhoneNumberInfo {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;           // GREEN | YELLOW | RED | UNKNOWN
  status?: string;                   // CONNECTED, FLAGGED, RESTRICTED…
  messaging_limit_tier?: string;     // TIER_250, TIER_2K, TIER_10K…
  name_status?: string;
  throughput?: { level: string };
}

// ── Webhook ──

export interface WaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{ id: string; changes: Array<{ field: string; value: any }> }>;
}

export interface WaInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  context?: { from?: string; id?: string; forwarded?: boolean };
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256?: string; caption?: string };
  video?: { id: string; mime_type: string; sha256?: string; caption?: string };
  audio?: { id: string; mime_type: string; sha256?: string; voice?: boolean };
  document?: { id: string; mime_type: string; sha256?: string; caption?: string; filename?: string };
  sticker?: { id: string; mime_type: string; sha256?: string; animated?: boolean };
  location?: { latitude: number; longitude: number; name?: string; address?: string; url?: string };
  contacts?: Array<Record<string, unknown>>;
  button?: { text: string; payload: string };
  interactive?: { type: 'button_reply' | 'list_reply'; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string; description?: string } };
  reaction?: { message_id: string; emoji?: string };
  errors?: Array<{ code: number; title: string; message?: string; error_data?: { details?: string } }>;
}

export interface WaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
  timestamp: string;
  recipient_id: string;
  conversation?: { id: string; origin?: { type: string }; expiration_timestamp?: string };
  pricing?: { billable: boolean; pricing_model: string; category: string; type?: string };
  errors?: Array<{ code: number; title: string; message?: string; error_data?: { details?: string } }>;
}

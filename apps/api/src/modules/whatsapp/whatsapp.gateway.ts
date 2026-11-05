import { Injectable, Logger } from '@nestjs/common';
import type { WaMediaInfo, WaOutboundMessage, WaPhoneNumberInfo, WaSendResponse, WaTemplate, WaGraphError, TemplateComponent } from '@gelado/shared';
import { metaErrorInfo, type MetaErrorInfo } from '@gelado/shared';
import { config } from '../../common/config';

/** Error de la Graph API con la información de docs/06 (código, traducción, si se reintenta). */
export class WhatsAppApiError extends Error {
  constructor(
    readonly httpStatus: number | undefined,
    readonly graph: WaGraphError | null,
    readonly info: MetaErrorInfo,
  ) {
    super(`${info.code}: ${graph?.message ?? info.es}`);
  }
  get code() {
    return this.info.code;
  }
  get retryable() {
    return this.info.retryable;
  }
}

/**
 * Contrato del cliente de la Graph API (docs/06). Una sola implementación HTTP: en local apunta al
 * simulador (META_GRAPH_BASE_URL=http://localhost:4010) y en producción a https://graph.facebook.com.
 * NUNCA incluye /register (CLAUDE.md, regla 2).
 */
export interface WhatsAppGatewayContract {
  sendMessage(toWaId: string, msg: WaOutboundMessage, opts?: { contextWamid?: string }): Promise<WaSendResponse>;
  markRead(wamid: string): Promise<void>;
  uploadMedia(data: Buffer, mimeType: string, fileName: string): Promise<{ id: string }>;
  getMediaInfo(mediaId: string): Promise<WaMediaInfo>;
  downloadMedia(url: string): Promise<{ data: Buffer; mimeType: string }>;
  listTemplates(): Promise<WaTemplate[]>;
  createTemplate(t: { name: string; language: string; category: string; components: TemplateComponent[] }): Promise<{ id: string; status: string; category: string }>;
  deleteTemplate(name: string, metaTemplateId?: string): Promise<void>;
  /** Resumable Upload API: devuelve el `handle` para example.header_handle */
  resumableUpload(data: Buffer, mimeType: string, fileName: string): Promise<string>;
  getPhoneNumber(): Promise<WaPhoneNumberInfo>;
}

@Injectable()
export class WhatsAppGateway implements WhatsAppGatewayContract {
  private readonly log = new Logger('WhatsAppGateway');

  private get base() {
    const c = config();
    return `${c.META_GRAPH_BASE_URL.replace(/\/$/, '')}/${c.GRAPH_API_VERSION}`;
  }
  private get auth() {
    return { Authorization: `Bearer ${config().WA_SYSTEM_USER_TOKEN}` };
  }

  private async call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      const isBin = body instanceof Uint8Array;
      res = await fetch(url, {
        method,
        headers: { ...this.auth, ...(body && !isForm && !isBin ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body == null ? undefined : isForm || isBin ? (body as any) : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new WhatsAppApiError(undefined, null, metaErrorInfo(null, undefined));
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const g: WaGraphError | null = json?.error ?? null;
      throw new WhatsAppApiError(res.status, g, metaErrorInfo(g?.code ?? null, res.status));
    }
    return json as T;
  }

  sendMessage(toWaId: string, msg: WaOutboundMessage, opts?: { contextWamid?: string }) {
    const body: Record<string, unknown> = { messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId.replace(/^\+/, ''), ...msg };
    if (opts?.contextWamid) body.context = { message_id: opts.contextWamid };
    return this.call<WaSendResponse>('POST', `${this.base}/${config().WA_PHONE_NUMBER_ID}/messages`, body);
  }

  async markRead(wamid: string) {
    await this.call('POST', `${this.base}/${config().WA_PHONE_NUMBER_ID}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: wamid });
  }

  async uploadMedia(data: Buffer, mimeType: string, fileName: string) {
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', mimeType);
    fd.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), fileName);
    return this.call<{ id: string }>('POST', `${this.base}/${config().WA_PHONE_NUMBER_ID}/media`, fd);
  }

  getMediaInfo(mediaId: string) {
    return this.call<WaMediaInfo>('GET', `${this.base}/${mediaId}`);
  }

  async downloadMedia(url: string) {
    let res: Response;
    try {
      res = await fetch(url, { headers: this.auth, signal: AbortSignal.timeout(60000) });
    } catch {
      throw new WhatsAppApiError(undefined, null, metaErrorInfo(null, undefined));
    }
    if (!res.ok) throw new WhatsAppApiError(res.status, null, { code: res.status, es: 'La URL del adjunto ha caducado o no está disponible', action: 'retry', retryable: true });
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async listTemplates() {
    const fields = 'id,name,status,category,language,components,quality_score,rejected_reason';
    let url: string | null = `${this.base}/${config().WA_WABA_ID}/message_templates?fields=${fields}&limit=100`;
    const all: WaTemplate[] = [];
    while (url) {
      const page: { data: WaTemplate[]; paging?: { next?: string } } = await this.call('GET', url);
      all.push(...page.data);
      url = page.paging?.next ?? null;
    }
    return all;
  }

  createTemplate(t: { name: string; language: string; category: string; components: TemplateComponent[] }) {
    return this.call<{ id: string; status: string; category: string }>('POST', `${this.base}/${config().WA_WABA_ID}/message_templates`, t);
  }

  async deleteTemplate(name: string, metaTemplateId?: string) {
    const q = new URLSearchParams({ name });
    if (metaTemplateId) q.set('hsm_id', metaTemplateId);
    await this.call('DELETE', `${this.base}/${config().WA_WABA_ID}/message_templates?${q}`);
  }

  async resumableUpload(data: Buffer, mimeType: string, fileName: string) {
    const c = config();
    const q = new URLSearchParams({ file_name: fileName, file_length: String(data.length), file_type: mimeType });
    const session = await this.call<{ id: string }>('POST', `${this.base}/${c.META_APP_ID}/uploads?${q}`);
    const up = await this.call<{ h: string }>('POST', `${this.base}/${session.id}`, new Uint8Array(data), {
      Authorization: `OAuth ${c.WA_SYSTEM_USER_TOKEN}`,
      file_offset: '0',
      'Content-Type': mimeType,
    });
    return up.h;
  }

  getPhoneNumber() {
    const fields = 'id,display_phone_number,verified_name,quality_rating,status,messaging_limit_tier,name_status,throughput';
    return this.call<WaPhoneNumberInfo>('GET', `${this.base}/${config().WA_PHONE_NUMBER_ID}?fields=${fields}`);
  }
}

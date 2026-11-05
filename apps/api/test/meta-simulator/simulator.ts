/**
 * Simulador de la Graph API de Meta (docs/06 · Simulador). Sin coste, sin red externa.
 *
 * ── Graph API simulada (prefijo /:version) ──
 *   POST /:phoneId/messages            → { messages:[{id:wamid}] } (texto, media, plantilla, interactivo); { status:'read' } se anota en `reads`
 *   POST /:phoneId/media               → { id }
 *   GET  /:mediaId                     → { url, mime_type, sha256, file_size } (404 si el media se ha borrado)
 *   GET  /_media/:mediaId              → binario (404 «URL caducada» si se ha forzado con expireMedia)
 *   GET/POST/DELETE /:wabaId/message_templates
 *   POST /:appId/uploads, POST /upload:<id> → Resumable Upload (handle)
 *   GET  /:phoneId                     → datos del número (calidad, límite)
 *   Nunca existe /register (regla 2): responde 400.
 *
 * ── Uso desde las pruebas (clase MetaSimulator) ──
 *   const sim = await startMetaSimulator({ appSecret: 'test-app-secret' });   // puerto aleatorio
 *   sim.opts.webhookUrl = `${appUrl}/webhooks/whatsapp`;                     // a dónde firma y envía los webhooks
 *   Entrantes:  await sim.sendInbound({ from:'34600111222', type:'text', text:{ body:'Hola' } })   // devuelve el status HTTP de la app
 *               sim.inboundPayload(...) construye el payload sin enviarlo; el campo `id` fija el wamid (duplicados)
 *   Estados:    await sim.sendStatus({ wamid, status:'delivered'|'read'|'failed', errorCode?, pricing? })
 *               pricing por defecto = { billable:true, pricing_model:'PMP', category:'service' }; `pricing:null` lo omite
 *   Duplicado:  await sim.postWebhook(payload) dos veces, o sendInbound({ ..., repeat: 2 })
 *   Firma:      postWebhook(payload, { signature: null | 'sha256=mala' }) para probar firma ausente o inválida
 *   Estado antes que la respuesta del envío:
 *               sim.sendDelayMs = 300; lanza el envío sin esperar; cuando aparezca en sim.sent envía sendStatus() con ese id
 *   URL de media caducada: const id = sim.addInboundMedia(buf, mime); sim.expireMedia(id, 1) → las 1ª descargas dan 404 y
 *               la siguiente petición de info genera una URL válida; sim.deleteMedia(id) → la info da 404 (borrado)
 *   Ráfaga 130429: sim.failNext({ code: 130429, count: 5, httpStatus: 429 }) → los próximos 5 envíos fallan; path:'media'|'messages'
 *   Webhooks de otros campos (forma real de Meta):
 *               sim.sendTemplateStatus({ event:'APPROVED'|'REJECTED'|'PAUSED'|'DISABLED'…, templateId, name, language?, reason? })
 *               sim.sendTemplateQuality({ templateId, name, previous, next })      // message_template_quality_update
 *               sim.sendTemplateCategory({ templateId, name, previous, next })     // template_category_update
 *               sim.sendPhoneQuality({ event:'DOWNGRADE'|'UPGRADE'|'FLAGGED'|'UNFLAGGED'|'ONBOARDING', currentLimit })  // phone_number_quality_update
 *               sim.sendAccountUpdate({ event:'ACCOUNT_RESTRICTION'|'ACCOUNT_VIOLATION'|'DISABLED_UPDATE'|…, ...extra })  // account_update
 *               sim.sendField(field, value) para cualquier otro
 *   Inspección: sim.sent (envíos recibidos), sim.reads (wamid marcados como leídos), sim.media, sim.webhooksSent; sim.reset()
 *
 * ── Control por HTTP (prefijo /_sim, para el CLI de desarrollo) ──
 *   POST /_sim/inbound   { from, type, ...campos, repeat? }     → firma y envía un webhook de mensaje entrante
 *   POST /_sim/status    { wamid, status, errorCode?, pricing?, repeat? } → webhook de estado
 *   POST /_sim/webhook   { field, value }                       → webhook arbitrario
 *   POST /_sim/template-status | template-quality | template-category | phone-quality | account-update  → helpers de arriba
 *   POST /_sim/fail-next { code, count?, httpStatus?, path? }   → los próximos envíos fallan con ese código
 *   POST /_sim/config    { sendDelayMs }
 *   POST /_sim/media     { mime, base64 } → { id } ;  POST /_sim/media-expire { id, downloads? } ;  POST /_sim/media-delete { id }
 *   GET  /_sim/sent ; POST /_sim/reset
 */
import http from 'node:http';
import { createHmac, randomUUID, createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface SimOptions {
  port?: number;
  appSecret: string;
  /** URL del webhook de la app (POST firmado) */
  webhookUrl?: string;
  phoneNumberId?: string;
  wabaId?: string;
  displayPhoneNumber?: string;
}

export interface SentRecord { id: string; path: string; body: any; at: number }
interface FailRule { code: number; count: number; httpStatus: number; path?: string; message?: string }

export class MetaSimulator {
  server: http.Server | null = null;
  port = 0;
  sent: SentRecord[] = [];
  media = new Map<string, { data: Buffer; mime: string; expired?: boolean; failDownloads?: number; deleted?: boolean }>();
  /** wamid marcados como leídos por la app */
  reads: string[] = [];
  templates = new Map<string, any>();
  uploads = new Map<string, Buffer>();
  failRules: FailRule[] = [];
  webhooksSent: any[] = [];
  phone = { quality_rating: 'GREEN', status: 'CONNECTED', messaging_limit_tier: 'TIER_2K', verified_name: 'Exclusivas Gelado', name_status: 'APPROVED' };
  /** retraso artificial antes de responder a /messages (para «estado antes que la respuesta») */
  sendDelayMs = 0;

  constructor(readonly opts: SimOptions) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
  get phoneNumberId() {
    return this.opts.phoneNumberId ?? '833139829886325';
  }
  get wabaId() {
    return this.opts.wabaId ?? '24936790469294569';
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => this.json(res, 500, { error: { message: String(e), code: 1 } })));
    await new Promise<void>((r) => this.server!.listen(this.opts.port ?? 0, '127.0.0.1', () => r()));
    this.port = (this.server!.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  reset() {
    this.sent = [];
    this.reads = [];
    this.media.clear();
    this.templates.clear();
    this.uploads.clear();
    this.failRules = [];
    this.webhooksSent = [];
    this.sendDelayMs = 0;
  }

  newWamid() {
    return `wamid.SIM${randomUUID().replace(/-/g, '')}`;
  }

  // ───────── webhooks ─────────

  sign(body: string) {
    return 'sha256=' + createHmac('sha256', this.opts.appSecret).update(body).digest('hex');
  }

  envelope(field: string, value: any) {
    return { object: 'whatsapp_business_account', entry: [{ id: this.wabaId, changes: [{ field, value }] }] };
  }

  metadata() {
    return { display_phone_number: this.opts.displayPhoneNumber ?? '34617498222', phone_number_id: this.phoneNumberId };
  }

  /** Envía un webhook firmado a la app. Devuelve el status HTTP. */
  async postWebhook(payload: any, opts: { signature?: string | null; url?: string } = {}) {
    const body = JSON.stringify(payload);
    this.webhooksSent.push(payload);
    const url = opts.url ?? this.opts.webhookUrl;
    if (!url) throw new Error('Simulador sin webhookUrl');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const sig = opts.signature === undefined ? this.sign(body) : opts.signature;
    if (sig) headers['X-Hub-Signature-256'] = sig;
    const r = await fetch(url, { method: 'POST', headers, body });
    return r.status;
  }

  /** Construye el payload de un mensaje entrante (sin enviarlo). */
  inboundPayload(m: { from: string; name?: string; type: string; id?: string; timestamp?: number; [k: string]: any }) {
    const { from, name, type, id, timestamp, context, ...rest } = m;
    const msg: any = { from, id: id ?? this.newWamid(), timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)), type, ...rest };
    if (context) msg.context = context;
    return this.envelope('messages', {
      messaging_product: 'whatsapp',
      metadata: this.metadata(),
      contacts: [{ profile: { name: name ?? 'Cliente Prueba' }, wa_id: from }],
      messages: [msg],
    });
  }

  statusPayload(s: { wamid: string; status: string; recipient?: string; timestamp?: number; errorCode?: number; errorTitle?: string; pricing?: any }) {
    const st: any = { id: s.wamid, status: s.status, timestamp: String(s.timestamp ?? Math.floor(Date.now() / 1000)), recipient_id: s.recipient ?? '34600000000' };
    if (s.pricing !== undefined) st.pricing = s.pricing;
    else if (s.status !== 'failed') st.pricing = { billable: true, pricing_model: 'PMP', category: 'service', type: 'regular' };
    if (s.errorCode) st.errors = [{ code: s.errorCode, title: s.errorTitle ?? `Error ${s.errorCode}`, message: s.errorTitle ?? '', error_data: { details: 'Simulado' } }];
    return this.envelope('messages', { messaging_product: 'whatsapp', metadata: this.metadata(), statuses: [st] });
  }

  // ───────── ayudantes para pruebas ─────────

  /** Firma y envía un mensaje entrante. `repeat` reenvía el mismo payload N veces (webhook duplicado). Devuelve el último status HTTP. */
  async sendInbound(m: { from: string; type: string; repeat?: number; [k: string]: any }) {
    const { repeat, ...msg } = m;
    const payload = this.inboundPayload(msg as any);
    let status = 0;
    for (let i = 0; i < (repeat ?? 1); i++) status = await this.postWebhook(payload);
    return status;
  }

  async sendStatus(s: { wamid: string; status: string; recipient?: string; timestamp?: number; errorCode?: number; errorTitle?: string; pricing?: any; repeat?: number }) {
    const payload = this.statusPayload(s.pricing === null ? { ...s, pricing: undefined } : s);
    if (s.pricing === null) delete payload.entry[0].changes[0].value.statuses[0].pricing;
    let status = 0;
    for (let i = 0; i < (s.repeat ?? 1); i++) status = await this.postWebhook(payload);
    return status;
  }

  /** Webhook de cualquier campo con la envoltura real de Meta. */
  sendField(field: string, value: any) {
    return this.postWebhook(this.envelope(field, value));
  }

  /** message_template_status_update */
  templateStatusPayload(t: { event: string; templateId: string | number; name: string; language?: string; reason?: string; disableInfo?: any }) {
    const value: any = {
      event: t.event,
      message_template_id: Number(t.templateId) || t.templateId,
      message_template_name: t.name,
      message_template_language: t.language ?? 'es',
      reason: t.reason ?? 'NONE',
    };
    if (t.disableInfo) value.disable_info = t.disableInfo;
    return this.envelope('message_template_status_update', value);
  }
  sendTemplateStatus(t: Parameters<MetaSimulator['templateStatusPayload']>[0]) {
    // Como la Meta real: el estado también cambia en el listado (GET /message_templates) para que una sincronización posterior no lo revierta
    const stored = [...this.templates.values()].find((x) => String(x.id) === String(t.templateId) || x.name === t.name);
    if (stored) {
      stored.status = t.event;
      if (t.reason && t.reason !== 'NONE') stored.rejected_reason = t.reason;
    }
    return this.postWebhook(this.templateStatusPayload(t));
  }

  /** message_template_quality_update (previous/next: GREEN | YELLOW | RED | UNKNOWN) */
  sendTemplateQuality(t: { templateId: string | number; name: string; language?: string; previous: string; next: string }) {
    return this.sendField('message_template_quality_update', {
      previous_quality_score: t.previous,
      new_quality_score: t.next,
      message_template_id: Number(t.templateId) || t.templateId,
      message_template_name: t.name,
      message_template_language: t.language ?? 'es',
    });
  }

  /** template_category_update */
  sendTemplateCategory(t: { templateId: string | number; name: string; language?: string; previous: string; next: string }) {
    return this.sendField('template_category_update', {
      message_template_id: Number(t.templateId) || t.templateId,
      message_template_name: t.name,
      message_template_language: t.language ?? 'es',
      previous_category: t.previous,
      new_category: t.next,
    });
  }

  /** phone_number_quality_update */
  sendPhoneQuality(q: { event: string; currentLimit?: string }) {
    return this.sendField('phone_number_quality_update', {
      display_phone_number: this.opts.displayPhoneNumber ?? '34617498222',
      event: q.event,
      current_limit: q.currentLimit ?? 'TIER_2K',
    });
  }

  /** account_update (restricciones, avisos, baneos) */
  sendAccountUpdate(a: { event: string; [k: string]: any }) {
    const { event, ...extra } = a;
    return this.sendField('account_update', { phone_number: this.opts.displayPhoneNumber ?? '34617498222', event, ...extra });
  }

  /** Los próximos `count` envíos (o llamadas que contengan `path`) fallan con ese código de Meta. */
  failNext(r: { code: number; count?: number; httpStatus?: number; path?: string; message?: string }) {
    this.failRules.push({ code: r.code, count: r.count ?? 1, httpStatus: r.httpStatus ?? (r.code === 130429 ? 429 : 400), path: r.path, message: r.message });
  }

  /** Las próximas `downloads` descargas del media dan 404 (URL caducada); después la info devuelve una URL válida. */
  expireMedia(id: string, downloads = 1) {
    const m = this.media.get(id);
    if (m) m.failDownloads = downloads;
  }

  /** El media desaparece: la info y la descarga dan 404. */
  deleteMedia(id: string) {
    const m = this.media.get(id);
    if (m) m.deleted = true;
  }

  // ───────── Graph API ─────────

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private takeFail(path: string): FailRule | null {
    const r = this.failRules.find((f) => f.count > 0 && (!f.path || path.includes(f.path)));
    if (!r) return null;
    r.count -= 1;
    return r;
  }

  private graphError(res: http.ServerResponse, rule: FailRule) {
    this.json(res, rule.httpStatus, {
      error: { message: rule.message ?? `(#${rule.code}) Error simulado`, type: 'OAuthException', code: rule.code, error_data: { messaging_product: 'whatsapp', details: 'Simulado' }, fbtrace_id: 'SIM' },
    });
  }

  private parseMultipart(buf: Buffer, contentType: string) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    const out: Record<string, { value?: string; data?: Buffer; filename?: string; type?: string }> = {};
    if (!boundary) return out;
    const b = '--' + (boundary[1] ?? boundary[2]);
    const parts = buf.toString('latin1').split(b).slice(1, -1);
    for (const p of parts) {
      const [head, ...bodyParts] = p.split('\r\n\r\n');
      const body = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '');
      const name = /name="([^"]+)"/.exec(head)?.[1];
      if (!name) continue;
      const filename = /filename="([^"]*)"/.exec(head)?.[1];
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1];
      out[name] = filename !== undefined ? { data: Buffer.from(body, 'latin1'), filename, type } : { value: Buffer.from(body, 'latin1').toString('utf8') };
    }
    return out;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const p = url.pathname;
    const raw = await this.readBody(req);
    const ct = req.headers['content-type'] ?? '';
    const body = ct.includes('application/json') && raw.length ? JSON.parse(raw.toString('utf8')) : null;

    // ── control ──
    if (p.startsWith('/_sim/')) return this.control(p, body, res);

    // Nunca existe /register en este simulador: la app no debe llamarlo (regla 2).
    if (/\/register$/.test(p)) return this.json(res, 400, { error: { message: 'PROHIBIDO: /register no se usa en este proyecto', code: 100 } });

    // descarga de media (no lleva versión)
    const dl = /^\/_media\/([^/]+)$/.exec(p);
    if (dl && req.method === 'GET') {
      const m = this.media.get(dl[1]!);
      if (m && (m.failDownloads ?? 0) > 0) {
        m.failDownloads! -= 1; // la URL emitida antes «caducó»; la siguiente petición de info da una válida
        return this.json(res, 404, { error: { message: 'URL caducada', code: 100 } });
      }
      if (!m || m.expired || m.deleted) return this.json(res, 404, { error: { message: 'URL caducada', code: 100 } });
      res.writeHead(200, { 'Content-Type': m.mime, 'Content-Length': m.data.length });
      return res.end(m.data);
    }

    if (!/^Bearer |^OAuth /.test(String(req.headers.authorization ?? ''))) return this.json(res, 401, { error: { message: 'Sin token', code: 190 } });

    const seg = p.split('/').filter(Boolean); // [version, id, edge?]
    const [, id, edge] = seg;

    if (req.method === 'POST' && id === this.phoneNumberId && edge === 'messages') {
      const fail = this.takeFail('messages');
      if (fail) return this.graphError(res, fail);
      if (body?.status === 'read') {
        this.reads.push(body.message_id);
        return this.json(res, 200, { success: true });
      }
      const wamid = this.newWamid();
      this.sent.push({ id: wamid, path: p, body, at: Date.now() });
      if (this.sendDelayMs) await new Promise((r) => setTimeout(r, this.sendDelayMs));
      return this.json(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: body?.to, wa_id: body?.to }], messages: [{ id: wamid }] });
    }

    if (req.method === 'POST' && id === this.phoneNumberId && edge === 'media') {
      const fail = this.takeFail('media');
      if (fail) return this.graphError(res, fail);
      const parts = this.parseMultipart(raw, ct);
      const file = parts.file;
      if (!file?.data) return this.json(res, 400, { error: { message: 'Falta file', code: 100 } });
      const mid = String(Math.floor(Math.random() * 1e15));
      this.media.set(mid, { data: file.data, mime: parts.type?.value ?? file.type ?? 'application/octet-stream' });
      return this.json(res, 200, { id: mid });
    }

    if (req.method === 'GET' && id === this.phoneNumberId && !edge) {
      return this.json(res, 200, { id, display_phone_number: '+34 617 49 82 22', ...this.phone, throughput: { level: 'STANDARD' } });
    }

    if (id === this.wabaId && edge === 'message_templates') {
      if (req.method === 'GET') return this.json(res, 200, { data: [...this.templates.values()], paging: {} });
      if (req.method === 'POST') {
        const fail = this.takeFail('message_templates');
        if (fail) return this.graphError(res, fail);
        const tid = String(Math.floor(Math.random() * 1e15));
        const t = { id: tid, status: 'PENDING', ...body };
        this.templates.set(tid, t);
        return this.json(res, 200, { id: tid, status: 'PENDING', category: body?.category });
      }
      if (req.method === 'DELETE') {
        const name = url.searchParams.get('name');
        for (const [k, t] of this.templates) if (t.name === name) this.templates.delete(k);
        return this.json(res, 200, { success: true });
      }
    }

    if (req.method === 'POST' && edge === 'uploads') {
      const sid = `upload:${randomUUID()}`;
      return this.json(res, 200, { id: sid });
    }
    if (req.method === 'POST' && id?.startsWith('upload:')) {
      this.uploads.set(id, raw);
      return this.json(res, 200, { h: `4::${Buffer.from(id).toString('base64')}:${createHash('sha1').update(raw).digest('hex').slice(0, 12)}` });
    }

    if (req.method === 'GET' && id && this.media.has(id)) {
      const m = this.media.get(id)!;
      if (m.deleted) return this.json(res, 404, { error: { message: 'Media no encontrado', code: 100 } });
      return this.json(res, 200, {
        messaging_product: 'whatsapp', id, url: `${this.baseUrl}/_media/${id}`, mime_type: m.mime,
        sha256: createHash('sha256').update(m.data).digest('hex'), file_size: m.data.length,
      });
    }

    return this.json(res, 404, { error: { message: `Simulador: ruta no implementada ${req.method} ${p}`, code: 100 } });
  }

  private async control(p: string, body: any, res: http.ServerResponse) {
    switch (p) {
      case '/_sim/inbound':
        return this.json(res, 200, { status: await this.sendInbound(body) });
      case '/_sim/status':
        return this.json(res, 200, { status: await this.sendStatus(body) });
      case '/_sim/webhook':
        return this.json(res, 200, { status: await this.sendField(body.field, body.value) });
      case '/_sim/template-status':
        return this.json(res, 200, { status: await this.sendTemplateStatus(body) });
      case '/_sim/template-quality':
        return this.json(res, 200, { status: await this.sendTemplateQuality(body) });
      case '/_sim/template-category':
        return this.json(res, 200, { status: await this.sendTemplateCategory(body) });
      case '/_sim/phone-quality':
        return this.json(res, 200, { status: await this.sendPhoneQuality(body) });
      case '/_sim/account-update':
        return this.json(res, 200, { status: await this.sendAccountUpdate(body) });
      case '/_sim/fail-next':
        this.failNext(body);
        return this.json(res, 200, { ok: true });
      case '/_sim/config':
        if (typeof body?.sendDelayMs === 'number') this.sendDelayMs = body.sendDelayMs;
        return this.json(res, 200, { ok: true, sendDelayMs: this.sendDelayMs });
      case '/_sim/media-expire':
        this.expireMedia(body.id, body.downloads ?? 1);
        return this.json(res, 200, { ok: true });
      case '/_sim/media-delete':
        this.deleteMedia(body.id);
        return this.json(res, 200, { ok: true });
      case '/_sim/sent':
        return this.json(res, 200, this.sent);
      case '/_sim/reset':
        this.reset();
        return this.json(res, 200, { ok: true });
      case '/_sim/media': {
        // añade un adjunto «entrante» que la app podrá descargar: { mime, base64 } → { id }
        const mid = String(Math.floor(Math.random() * 1e15));
        this.media.set(mid, { data: Buffer.from(body.base64 ?? '', 'base64'), mime: body.mime ?? 'image/jpeg' });
        return this.json(res, 200, { id: mid });
      }
      default:
        return this.json(res, 404, { error: 'control desconocido' });
    }
  }

  /** Registra un adjunto entrante y devuelve su id de media. */
  addInboundMedia(data: Buffer, mime: string) {
    const mid = String(Math.floor(Math.random() * 1e15));
    this.media.set(mid, { data, mime });
    return mid;
  }
}

export async function startMetaSimulator(opts: SimOptions) {
  return new MetaSimulator(opts).start();
}

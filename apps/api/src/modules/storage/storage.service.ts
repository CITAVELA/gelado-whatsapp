import { Controller, ForbiddenException, Get, Global, Injectable, Module, NotFoundException, Query, Res, Param } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { config } from '../../common/config';
import { hmacSha256Hex, safeEqual } from '../../common/tokens';
import { Public } from '../../common/decorators';
import { attachmentDisposition } from '../../common/content-disposition';

/**
 * Interfaz con la forma de Supabase Storage (bucket privado `media`).
 * `local` guarda en disco y firma URLs con HMAC; `supabase` usa la API REST de Storage con la clave service_role
 * (solo en el servidor; el navegador solo ve URLs firmadas de 1 h).
 */
export interface StorageDriver {
  upload(objectPath: string, data: Buffer, opts: { contentType: string; upsert?: boolean }): Promise<void>;
  download(objectPath: string): Promise<Buffer>;
  createSignedUrl(objectPath: string, expiresInSeconds: number, opts?: { download?: string }): Promise<string>;
  /** Firma varias rutas de una vez (en Supabase, una sola petición por lote). Las que fallen no aparecen en el resultado. */
  createSignedUrls(objectPaths: string[], expiresInSeconds: number): Promise<Map<string, string>>;
  remove(objectPaths: string[]): Promise<void>;
}

/** Las URLs se firman por 2 h y se reutilizan como mucho 50 min: el navegador siempre recibe ≥ 70 min de vida (N7). */
export const SIGNED_URL_TTL = 2 * 3600;
/** Una URL firmada de 1 h se reutiliza hasta 50 min: al navegador siempre le quedan más de 10 min de validez. */
export const SIGNED_URL_CACHE_MS = 50 * 60_000;
const SIGNED_URL_CACHE_MAX = 5000;
const SIGN_BATCH = 100;

/** Ruta media/AAAA/MM/<uuid>.<ext> (docs/04) */
export function buildObjectPath(ext: string, now = new Date()): string {
  const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'bin';
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}/${m}/${randomUUID()}.${clean}`;
}

export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root: string, private readonly bucket: string, private readonly secret: string, private readonly baseUrl: string) {}
  private file(p: string) {
    const safe = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, '');
    if (safe.includes('..')) throw new Error('Ruta no válida');
    return path.join(this.root, this.bucket, safe);
  }
  async upload(p: string, data: Buffer, opts: { contentType: string; upsert?: boolean }) {
    const f = this.file(p);
    await fs.mkdir(path.dirname(f), { recursive: true });
    if (!opts.upsert) {
      const exists = await fs.stat(f).then(() => true, () => false);
      if (exists) throw new Error('El objeto ya existe');
    }
    await fs.writeFile(f, data);
    await fs.writeFile(f + '.meta.json', JSON.stringify({ contentType: opts.contentType }));
  }
  async download(p: string) {
    return fs.readFile(this.file(p));
  }
  async contentType(p: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(p) + '.meta.json', 'utf8')).contentType as string;
    } catch {
      return 'application/octet-stream';
    }
  }
  sign(p: string, exp: number) {
    return hmacSha256Hex(this.secret, `${this.bucket}/${p}:${exp}`);
  }
  async createSignedUrl(p: string, expiresIn: number, opts?: { download?: string }) {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const q = new URLSearchParams({ exp: String(exp), sig: this.sign(p, exp) });
    if (opts?.download) q.set('download', opts.download);
    return `${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${p}?${q}`;
  }
  async createSignedUrls(paths: string[], expiresIn: number) {
    const out = new Map<string, string>();
    for (const p of paths) out.set(p, await this.createSignedUrl(p, expiresIn));
    return out;
  }
  verify(p: string, exp: number, sig: string) {
    return exp * 1000 > Date.now() && safeEqual(this.sign(p, exp), sig);
  }
  async remove(paths: string[]) {
    for (const p of paths) {
      await fs.rm(this.file(p), { force: true });
      await fs.rm(this.file(p) + '.meta.json', { force: true });
    }
  }
}

export class SupabaseStorageDriver implements StorageDriver {
  constructor(private readonly url: string, private readonly key: string, private readonly bucket: string) {}
  private h(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }
  async upload(p: string, data: Buffer, opts: { contentType: string; upsert?: boolean }) {
    const r = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${p}`, {
      method: 'POST',
      headers: this.h({ 'Content-Type': opts.contentType, 'x-upsert': opts.upsert ? 'true' : 'false' }),
      body: new Uint8Array(data),
    });
    if (!r.ok) throw new Error(`Supabase upload ${r.status}: ${await r.text()}`);
  }
  async download(p: string) {
    const r = await fetch(`${this.url}/storage/v1/object/authenticated/${this.bucket}/${p}`, { headers: this.h() });
    if (!r.ok) throw new Error(`Supabase download ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  async createSignedUrl(p: string, expiresIn: number, opts?: { download?: string }) {
    const r = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}/${p}`, {
      method: 'POST',
      headers: this.h({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) throw new Error(`Supabase sign ${r.status}`);
    const j = (await r.json()) as { signedURL: string };
    const u = `${this.url}/storage/v1${j.signedURL}`;
    return opts?.download ? `${u}&download=${encodeURIComponent(opts.download)}` : u;
  }
  /** `POST /storage/v1/object/sign/{bucket}` con `paths`: una petición por cada 100 rutas. */
  async createSignedUrls(paths: string[], expiresIn: number) {
    const out = new Map<string, string>();
    for (let i = 0; i < paths.length; i += SIGN_BATCH) {
      const chunk = paths.slice(i, i + SIGN_BATCH);
      const r = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}`, {
        method: 'POST',
        headers: this.h({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn, paths: chunk }),
      });
      if (!r.ok) throw new Error(`Supabase sign (lote) ${r.status}`);
      const j = (await r.json()) as Array<{ path?: string; signedURL?: string | null; error?: string | null }>;
      for (const it of j) if (it?.path && it.signedURL && !it.error) out.set(it.path, `${this.url}/storage/v1${it.signedURL}`);
    }
    return out;
  }
  async remove(paths: string[]) {
    const r = await fetch(`${this.url}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.h({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!r.ok) throw new Error(`Supabase remove ${r.status}`);
  }
}

@Injectable()
export class StorageService implements StorageDriver {
  readonly driver: StorageDriver;
  constructor() {
    const c = config();
    this.driver =
      c.STORAGE_DRIVER === 'supabase'
        ? new SupabaseStorageDriver(c.SUPABASE_URL.replace(/\/$/, ''), c.SUPABASE_SERVICE_ROLE_KEY, c.SUPABASE_STORAGE_BUCKET)
        : new LocalStorageDriver(path.resolve(c.LOCAL_STORAGE_DIR), c.SUPABASE_STORAGE_BUCKET, c.SESSION_SECRET, '');
  }
  upload(p: string, d: Buffer, o: { contentType: string; upsert?: boolean }) {
    return this.driver.upload(p, d, o);
  }
  download(p: string) {
    return this.driver.download(p);
  }
  /** Caché en memoria de URLs firmadas por ruta (≈50 min): el historial de una conversación no firma lo mismo en cada petición. */
  private readonly signed = new Map<string, { url: string; until: number }>();

  private cacheKey(p: string, expiresIn: number) {
    return `${p}|${expiresIn}`;
  }
  private cached(p: string, expiresIn: number): string | null {
    const hit = this.signed.get(this.cacheKey(p, expiresIn));
    return hit && hit.until > Date.now() ? hit.url : null;
  }
  private remember(p: string, expiresIn: number, url: string) {
    if (this.signed.size >= SIGNED_URL_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of this.signed) if (v.until <= now) this.signed.delete(k);
      // Si sigue lleno, fuera las más antiguas (el Map conserva el orden de inserción)
      for (const k of this.signed.keys()) {
        if (this.signed.size < SIGNED_URL_CACHE_MAX * 0.9) break;
        this.signed.delete(k);
      }
    }
    this.signed.set(this.cacheKey(p, expiresIn), { url, until: Date.now() + Math.min(SIGNED_URL_CACHE_MS, expiresIn * 1000 * 0.83) });
  }

  async createSignedUrl(p: string, e = SIGNED_URL_TTL, o?: { download?: string }) {
    if (o?.download) return this.driver.createSignedUrl(p, e, o);
    const hit = this.cached(p, e);
    if (hit) return hit;
    const url = await this.driver.createSignedUrl(p, e);
    this.remember(p, e, url);
    return url;
  }

  /** Firma en lote las rutas que no estén ya en caché; después `createSignedUrl` las sirve sin salir a la red. */
  async primeSignedUrls(paths: string[], e = SIGNED_URL_TTL): Promise<void> {
    const missing = [...new Set(paths)].filter((p) => p && !this.cached(p, e));
    if (missing.length < 2) return; // una sola ruta: la firma individual ya es una petición
    try {
      for (const [p, url] of await this.driver.createSignedUrls(missing, e)) this.remember(p, e, url);
    } catch {
      /* si falla el lote, cada ruta se firma por separado al pedirla */
    }
  }

  async createSignedUrls(paths: string[], e = SIGNED_URL_TTL): Promise<Map<string, string>> {
    await this.primeSignedUrls(paths, e);
    const out = new Map<string, string>();
    for (const p of new Set(paths)) out.set(p, await this.createSignedUrl(p, e));
    return out;
  }
  remove(p: string[]) {
    for (const x of p) for (const k of this.signed.keys()) if (k.startsWith(x + '|')) this.signed.delete(k);
    return this.driver.remove(p);
  }
}

/** Sirve las URLs firmadas del adaptador local (misma ruta que Supabase: /storage/v1/object/sign/...). */
@Controller('storage/v1/object/sign')
export class LocalStorageController {
  constructor(private readonly storage: StorageService) {}
  @Public()
  @Get(':bucket/*path')
  async get(@Param('bucket') bucket: string, @Param('path') p: string | string[], @Query('exp') exp: string, @Query('sig') sig: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const d = this.storage.driver;
    if (!(d instanceof LocalStorageDriver)) throw new NotFoundException();
    const objectPath = Array.isArray(p) ? p.join('/') : p;
    if (bucket !== config().SUPABASE_STORAGE_BUCKET || !d.verify(objectPath, Number(exp), String(sig ?? ''))) {
      throw new ForbiddenException({ statusCode: 403, message: 'Enlace caducado o no válido' });
    }
    const data = await d.download(objectPath).catch(() => null);
    if (!data) throw new NotFoundException();
    res.setHeader('Content-Type', await d.contentType(objectPath));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (download) res.setHeader('Content-Disposition', attachmentDisposition(download));
    res.send(data);
  }
}

@Global()
@Module({ providers: [StorageService], controllers: [LocalStorageController], exports: [StorageService] })
export class StorageModule {}

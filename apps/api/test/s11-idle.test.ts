/**
 * S11 · Consumo en reposo. Mide los BYTES REALES que el servicio envía/recibe de PostgreSQL mediante un proxy TCP
 * local, con workers activos (WORKER_ENABLED=true, JobsService fuera de modo inline) y sin actividad durante 120 s.
 *
 * Presupuesto (cálculo):
 *   Objetivo del cliente: < 2 MB/h hacia la BD en reposo (< 3 GB/mes en total; 2 MB/h x 730 h = 1,4 GB/mes).
 *   Ventana de la prueba = 120 s  ->  2 MB x 120/3600 = 66,7 kB (suma de ambos sentidos).
 *   Margen del 30 % para el cifrado TLS hacia Supabase (el proxy local cuenta texto plano; TLS añade ~5-15 %)
 *   y para el mantenimiento de pg-boss cada 30 min (no cae en la ventana)  ->  tope de la prueba = 66,7 kB x 0,7 ≈ 46,6 kB.
 *   Para consultas/min: con los bytes medios por consulta (medidos aquí) el tope equivale a MAX_QUERIES_PER_MIN.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { createTestApp, type TestApp } from './utils/app';
import { JobsService } from '../src/modules/jobs/jobs.service';

const WINDOW_S = Number(process.env.S11_WINDOW_S || 120);
const BUDGET_BYTES_PER_HOUR = 2 * 1024 * 1024;
const TLS_MARGIN = 0.7;
const BUDGET_BYTES = Math.floor((BUDGET_BYTES_PER_HOUR * WINDOW_S) / 3600 * TLS_MARGIN);

interface Counters { toDb: number; fromDb: number; queries: number; connections: number; sql: Map<string, number> }

function startProxy(target: { host: string; port: number }) {
  const c: Counters = { toDb: 0, fromDb: 0, queries: 0, connections: 0, sql: new Map() };
  const server = net.createServer((client) => {
    c.connections++;
    const up = net.connect(target.port, target.host);
    client.on('data', (d) => {
      c.toDb += d.length;
      // Mensajes de protocolo PG que inician una consulta: Query ('Q') y Parse ('P') / Execute ('E') del protocolo extendido.
      // Se cuenta 'Q' y 'B' (Bind) como una consulta cada uno (solo aproximado: un paquete puede traer varios mensajes).
      for (let i = 0; i < d.length; ) {
        const t = String.fromCharCode(d[i]!);
        const len = d.readUInt32BE(i + 1);
        if (t === 'Q' || t === 'B') c.queries++;
        if (t === 'Q' || t === 'P') {
          // Q: texto SQL tras el prefijo; P: nombre de sentencia\0 SQL\0
          const txt = d.subarray(i + 5, i + 1 + len).toString('utf8').replace(/\0.*$/s, (m) => (t === 'P' ? m.split('\0')[1] ?? '' : '')).slice(0, 90);
          const key = t === 'P' ? d.subarray(i + 5, i + 1 + len).toString('utf8').split('\0')[1]?.slice(0, 90) ?? '' : txt;
          c.sql.set(key, (c.sql.get(key) ?? 0) + 1);
        }
        if (len < 4 || i + 1 + len > d.length) break;
        i += 1 + len;
      }
      up.write(d);
    });
    up.on('data', (d) => {
      c.fromDb += d.length;
      client.write(d);
    });
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
    client.on('error', () => up.destroy());
    up.on('error', () => client.destroy());
  });
  return new Promise<{ server: net.Server; port: number; c: Counters }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, c })));
}

let t: TestApp;
let proxy: Awaited<ReturnType<typeof startProxy>>;
const saved = { url: process.env.DATABASE_URL, worker: process.env.WORKER_ENABLED };

beforeAll(async () => {
  const direct = new URL(process.env.DATABASE_URL!.replace(/^postgresql:/, 'http:'));
  proxy = await startProxy({ host: direct.hostname, port: Number(direct.port || 5432) });
  const viaProxy = new URL(process.env.DATABASE_URL!.replace(/^postgresql:/, 'http:'));
  viaProxy.hostname = '127.0.0.1';
  viaProxy.port = String(proxy.port);
  viaProxy.searchParams.set('sslmode', 'disable'); // en claro, para poder contar sentencias (Prisma negocia TLS si el servidor lo ofrece)
  process.env.DATABASE_URL = viaProxy.toString().replace(/^http:/, 'postgresql:');
  process.env.WORKER_ENABLED = 'true';
  t = await createTestApp({ WORKER_ENABLED: 'true', DATABASE_URL: process.env.DATABASE_URL });
  await t.reset();
}, 120_000);

afterAll(async () => {
  await t?.close();
  proxy?.server.close();
  process.env.DATABASE_URL = saved.url;
  process.env.WORKER_ENABLED = saved.worker;
});

describe('S11 · consumo en reposo', () => {
  it(`en ${WINDOW_S} s sin actividad no supera ${(BUDGET_BYTES / 1024).toFixed(1)} kB hacia/desde la BD (< 2 MB/h)`, async () => {
    const jobs = t.app.get(JobsService);
    expect(jobs.inlineMode).toBe(false);
    let cronTicks = 0;
    const orig = jobs.runCronsFor.bind(jobs);
    jobs.runCronsFor = async (n: Date) => {
      cronTicks++;
      await orig(n);
    };
    // calentamiento: arranque de pg-boss, primeras consultas de Prisma y primer ciclo de sondeo
    await new Promise((r) => setTimeout(r, 20_000));
    const before = { ...proxy.c };
    proxy.c.sql.clear();
    await new Promise((r) => setTimeout(r, WINDOW_S * 1000));
    const d = { toDb: proxy.c.toDb - before.toDb, fromDb: proxy.c.fromDb - before.fromDb, queries: proxy.c.queries - before.queries, newConnections: proxy.c.connections - before.connections };
    const total = d.toDb + d.fromDb;
    console.log(`[S11] ticks de cron en la ventana: ${cronTicks}`);
    const perHour = Math.round((total * 3600) / WINDOW_S);
    // eslint-disable-next-line no-console
    console.log(`[S11 reposo] ${WINDOW_S}s: ${d.queries} consultas (${(d.queries / (WINDOW_S / 60)).toFixed(1)}/min), ${d.toDb} B enviados + ${d.fromDb} B recibidos = ${total} B · ${(perHour / 1024 / 1024).toFixed(2)} MB/h · ${((perHour * 730) / 1024 ** 3).toFixed(2)} GB/mes · conexiones nuevas: ${d.newConnections}`);
    if (process.env.S11_VERBOSE) console.log([...proxy.c.sql.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v}  ${k}`).join('\n'));
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
    // Sin renovación de conexiones en cada sondeo (antes: ~12 por 120 s). Se tolera una reconexión puntual
    // del pool (máquina cargada por otras pruebas en paralelo); el presupuesto en bytes ya la incluye.
    expect(d.newConnections).toBeLessThanOrEqual(1);
  }, 200_000);
});

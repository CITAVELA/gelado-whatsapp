/**
 * QA · utilidades de la interfaz que cuelgan de reglas de negocio: ventana de 24 h, posponer con cambio de hora,
 * formato en español (EUR, Europe/Madrid), escape de HTML y límites de adjuntos de WhatsApp.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { validateMediaForWhatsApp } from '@gelado/shared';
import { fmtBytes, fmtDateTime, fmtEur, fmtNumber, fmtPct, fmtTime } from '../../lib/format';
import { isWindowOpen, remainingText, snoozeOptions, windowExpiresSoon, windowRemainingMs } from './utils';
import { renderWhatsApp } from './whatsappFormat';

describe('QA · ventana de 24 h en la interfaz', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  it('abierta mientras queda tiempo; cerrada en el instante exacto y después; sin fecha manda windowOpen', () => {
    expect(isWindowOpen({ windowExpiresAt: new Date(now + 1).toISOString() }, now)).toBe(true);
    expect(isWindowOpen({ windowExpiresAt: new Date(now).toISOString() }, now)).toBe(false);
    expect(isWindowOpen({ windowExpiresAt: new Date(now - 1000).toISOString() }, now)).toBe(false);
    expect(isWindowOpen({ windowExpiresAt: null }, now)).toBe(false);
    expect(isWindowOpen({ windowExpiresAt: null, windowOpen: true }, now)).toBe(true);
  });
  it('el aviso de «a punto de cerrarse» salta a las 2 h y no con la ventana ya cerrada', () => {
    expect(windowExpiresSoon(new Date(now + 119 * 60_000).toISOString(), now)).toBe(true);
    expect(windowExpiresSoon(new Date(now + 121 * 60_000).toISOString(), now)).toBe(false);
    expect(windowExpiresSoon(new Date(now - 1).toISOString(), now)).toBe(false);
    expect(windowRemainingMs(undefined, now)).toBe(0);
  });
  it('la cuenta atrás se lee en horas y en minutos, nunca «0 h» ni negativa', () => {
    expect(remainingText(23.9 * 3600_000)).toBe('23 h');
    expect(remainingText(59 * 60_000)).toBe('59 min');
    expect(remainingText(10_000)).toBe('1 min');
    expect(remainingText(-5)).toBe('0 min');
  });
});

describe('QA · posponer con el cambio de hora de Europa/Madrid', () => {
  it('sábado 24/10/2026 22:00: «Mañana» es el domingo 25/10 a las 08:00 de invierno (07:00 UTC)', () => {
    const o = snoozeOptions(new Date('2026-10-24T20:00:00Z'));
    expect(o[0]!.at.toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(o[1]!.at.toISOString()).toBe('2026-10-26T07:00:00.000Z'); // lunes 08:00 CET
    expect(o[0]!.hint).toBe('25/10, 08:00');
  });
  it('sábado 28/03/2026 21:00: «Mañana» es el 29/03 a las 08:00 de verano (06:00 UTC)', () => {
    const o = snoozeOptions(new Date('2026-03-28T20:00:00Z'));
    expect(o[0]!.at.toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(o[1]!.at.toISOString()).toBe('2026-03-30T06:00:00.000Z');
  });
  it('un domingo, «Lunes» es el día siguiente y nunca hoy', () => {
    const o = snoozeOptions(new Date('2026-11-08T11:00:00Z')); // domingo
    expect(o[1]!.hint).toBe('09/11, 08:00');
  });
  it('todas las opciones son futuras', () => {
    const base = new Date('2026-11-05T22:59:00Z');
    for (const o of snoozeOptions(base)) expect(o.at.getTime()).toBeGreaterThan(base.getTime());
  });
});

describe('QA · formato en español, EUR y Europe/Madrid', () => {
  it('euros con coma decimal y símbolo; miles con punto', () => {
    expect(fmtEur(0.0585)).toMatch(/0,06\s?€|0,0585\s?€/);
    expect(fmtEur(12345.5).replace(/\s/g, ' ')).toMatch(/12\.345,50 €/); // 4 cifras sin punto (norma es-ES/CLDR)
    expect(fmtEur(null)).toMatch(/—|0,00/);
  });
  it('números y porcentajes en español', () => {
    expect(fmtNumber(65600)).toBe('65.600');
    expect(fmtPct(1, 3)).toMatch(/33(,\d)? %/);
    expect(fmtPct(0, 0)).toMatch(/0 %|—/);
  });
  // CORREGIDO F-19 (bajo): Intl es-ES no agrupa los números de 4 cifras («6560», «6253»); el cliente y docs/03 escriben «6.560 contactos»
  it('los números de 4 cifras llevan punto de millar como en la documentación («6.560»)', () => {
    expect(fmtNumber(6560)).toBe('6.560');
  });
  it('las horas se muestran en Europa/Madrid aunque el navegador esté en otra zona (verano e invierno)', () => {
    expect(fmtTime('2026-07-01T10:30:00Z')).toBe('12:30'); // CEST
    expect(fmtTime('2026-12-01T10:30:00Z')).toBe('11:30'); // CET
    expect(fmtDateTime('2026-10-25T00:30:00Z')).toMatch(/25\/10\/2026.*02:30/);
  });
  it('tamaños de archivo legibles', () => {
    expect(fmtBytes(398)).toBe('398 B');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5,0 MB');
  });
  // F-15: fmtBytes usa coma decimal española («5,5 MB»)
  it('los tamaños usan coma decimal', () => {
    expect(fmtBytes(5.5 * 1024 * 1024)).toBe('5,5 MB');
  });
});

describe('QA · formato de WhatsApp: seguro y fiel', () => {
  it('el HTML del cliente se muestra como texto, nunca se interpreta', () => {
    const { container } = render(<>{renderWhatsApp('<img src=x onerror=alert(1)> *<b>hola</b>* <script>alert(2)</script>')}</>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('solo enlaza http(s): javascript: y data: no se convierten en enlaces', () => {
    const { container } = render(<>{renderWhatsApp('javascript:alert(1) data:text/html,hola https://gelado.eu/catalogo')}</>);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://gelado.eu/catalogo']);
    expect(container.querySelector('a')!.getAttribute('rel')).toMatch(/noopener/);
  });
  it('marcas sin cerrar o pegadas a palabras no formatean (2*3*4, snake_case_nombre)', () => {
    const { container } = render(<>{renderWhatsApp('2*3*4 y snake_case_nombre y *sin cerrar')}</>);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
  });
  it('negrita anidada con cursiva y texto con saltos de línea', () => {
    const { container } = render(<>{renderWhatsApp('*negrita _y cursiva_* fin')}</>);
    expect(container.querySelector('strong em')?.textContent).toBe('y cursiva');
  });
});

describe('QA · límites de adjuntos de WhatsApp (los que valida el compositor)', () => {
  it('imagen: JPEG/PNG hasta 5 MB; GIF y WebP de foto no', () => {
    expect(validateMediaForWhatsApp('image/jpeg', 5 * 1024 * 1024).ok).toBe(true);
    expect(validateMediaForWhatsApp('image/jpeg', 5 * 1024 * 1024 + 1).ok).toBe(false);
    expect(validateMediaForWhatsApp('image/gif', 1000).ok).toBe(false);
  });
  it('PDF hasta 100 MB; vídeo hasta 16 MB; audio webm del navegador sí (se convierte)', () => {
    expect(validateMediaForWhatsApp('application/pdf', 100 * 1024 * 1024).ok).toBe(true);
    expect(validateMediaForWhatsApp('application/pdf', 100 * 1024 * 1024 + 1).ok).toBe(false);
    expect(validateMediaForWhatsApp('video/mp4', 16 * 1024 * 1024 + 1).ok).toBe(false);
    expect(validateMediaForWhatsApp('audio/webm;codecs=opus', 50_000).ok).toBe(true);
  });
  it('los motivos de rechazo están en español', () => {
    const r = validateMediaForWhatsApp('application/x-msdownload', 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no admitido/i);
  });
});

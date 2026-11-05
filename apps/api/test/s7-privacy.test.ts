import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ADMIN_EMAIL, AGENT_EMAIL, type TestApp } from './utils/app';
import { PrivacyService, slugify } from '../src/modules/settings/privacy.service';
import { privacyPlaceholders } from '@gelado/shared';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

describe('S7 · /privacidad (RF-7.6)', () => {
  it('responde 200 sin sesión con HTML completo, el texto del ajuste y el ancla #supresion', async () => {
    const r = await t.http.get('/privacidad');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).toMatch(/^<!doctype html>/i);
    expect(r.text).toContain('<html lang="es">');
    expect(r.text).toContain('Política de privacidad');
    expect(r.text).toContain('id="supresion"');
    expect(r.text).toContain('+34 617 49 82 22');
    expect(r.text).toContain('GEL');
    expect(r.text).toContain('width=device-width');
    expect(r.text).not.toMatch(/<script/i);
    expect(r.text).not.toMatch(/\{#supresion\}/);
    // CSP de la app: sin scripts; estilos en línea permitidos
    expect(r.headers['content-security-policy']).toMatch(/script-src 'self'/);
    expect(r.headers['content-security-policy']).toMatch(/style-src 'self' 'unsafe-inline'/);
  });

  it('el texto editado se publica sin desplegar; ids sin tildes; fecha de actualización', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const md = '# Mi política\n\n## Qué datos tratamos\n\nTexto **importante**.\n\n## Cómo solicitar la supresión de tus datos\n\nEscríbenos.\n\n## Qué datos tratamos\n\nrepetido';
    const put = await admin.put('/api/settings/privacy_policy', { markdown: md });
    expect(put.status).toBe(200);
    const r = await t.http.get('/privacidad');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<h1 id="mi-politica">Mi política</h1>');
    expect(r.text).toContain('id="que-datos-tratamos"');
    expect(r.text).toContain('id="que-datos-tratamos-2"');
    expect(r.text).toContain('id="supresion"');
    expect(r.text).toContain('<strong>importante</strong>');
    expect(r.text).toMatch(/Última actualización: \d{1,2} de \w+ de \d{4}/);
  });

  it('un id explícito {#x} manda y la sección de supresión puede declararlo', async () => {
    const svc = t.app.get(PrivacyService);
    const html = svc.renderMarkdown('## Borrar datos {#supresion}\n\nx\n\n## Otra supresión\n\ny');
    expect(html).toContain('<h2 id="supresion">Borrar datos</h2>');
    expect(html).toMatch(/<h2 id="otra-supresion">/);
  });

  it('HTML malicioso en el Markdown se elimina', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const evil = [
      '# Política',
      '<script>alert("xss")</script>',
      '<img src=x onerror="alert(1)">',
      '<iframe src="https://evil.example"></iframe>',
      '<a href="javascript:alert(1)">pincha</a> y [otro](javascript:alert(2))',
      '<h2 id="x" onclick="alert(3)">Título</h2>',
      '<div style="position:fixed">overlay</div>',
      '<style>body{display:none}</style>',
      '<form action="https://evil.example"><input name="p"></form>',
      '[bueno](https://www.aepd.es)',
    ].join('\n\n');
    await admin.put('/api/settings/privacy_policy', { markdown: evil });
    const r = await t.http.get('/privacidad');
    expect(r.status).toBe(200);
    const body = r.text.slice(r.text.indexOf('<main>'));
    for (const bad of [/<script/i, /alert\(/i, /onerror/i, /onclick/i, /<iframe/i, /javascript:/i, /<img/i, /<form/i, /<input/i, /position:fixed/i, /display:none/i]) expect(body, String(bad)).not.toMatch(bad);
    expect(body).toContain('https://www.aepd.es');
    expect(body).toContain('rel="noopener noreferrer"');
    expect(body).toContain('Título');
  });

  it('vista previa para la administradora: HTML saneado y campos [entre corchetes] pendientes; el agente no puede', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const agent = await loginAs(t, AGENT_EMAIL);
    const md = '## Responsable\n\nCIF: [CIF]. Domicilio: [domicilio social]. Web: [aepd](https://aepd.es) <script>x</script> [CIF]';
    const r = await admin.post('/api/settings/privacy/preview', { markdown: md });
    expect(r.status).toBe(200);
    expect(r.body.html).toContain('<h2 id="responsable">Responsable</h2>');
    expect(r.body.html).not.toContain('<script');
    expect(r.body.placeholders).toEqual(['[CIF]', '[domicilio social]']);
    expect((await agent.post('/api/settings/privacy/preview', { markdown: md })).status).toBe(403);
    expect((await admin.post('/api/settings/privacy/preview', {})).status).toBe(400);
    // el contenido inicial (docs/legal) aún trae campos por rellenar
    const initial = (await t.prisma.setting.findUniqueOrThrow({ where: { key: 'privacy_policy' } })).value as { markdown: string };
    expect(privacyPlaceholders(initial.markdown)).toEqual(expect.arrayContaining(['[CIF]', '[domicilio social]', '[correo de contacto]']));
  });

  it('texto vacío muestra aviso en lugar de página en blanco; slugify quita tildes', async () => {
    await t.prisma.setting.update({ where: { key: 'privacy_policy' }, data: { value: { markdown: '', updatedAt: new Date().toISOString() } } });
    const r = await t.http.get('/privacidad');
    expect(r.status).toBe(200);
    expect(r.text).toContain('se está preparando');
    expect(slugify('¿Cómo ejercer tus derechos? Ñandú')).toBe('como-ejercer-tus-derechos-nandu');
  });

  it('privacy_policy no se filtra por GET /api/settings y /privacidad no pide CSRF ni cookie', async () => {
    const agent = await loginAs(t, AGENT_EMAIL);
    expect((await agent.get('/api/settings')).body.privacy_policy).toBeUndefined();
    expect((await t.http.get('/privacidad')).status).toBe(200);
  });
});

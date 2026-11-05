/**
 * (i) /privacidad pública y con el texto en el HTML (sin JavaScript), con #supresion
 * (j) móvil 390×844: lista → conversación → atrás, sin desbordes horizontales
 * + acceso: errores de login en español y pantallas protegidas.
 */
import { expect, test } from '@playwright/test';
import { CRISTINA, api, inboundText, json, login, logout, phone } from '../helpers';

test('(i) /privacidad responde 200 sin sesión, con el texto en el HTML y el ancla #supresion', async ({ request }) => {
  const r = await request.get('/privacidad');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/text\/html/);
  const html = await r.text();
  expect(html).toMatch(/id="supresion"/);
  expect(html).toMatch(/supresi[oó]n/i);
  expect(html).toMatch(/Exclusivas Gelado/i);
  expect(html).not.toMatch(/<div id="root"><\/div>/); // renderizado en el servidor, no una SPA vacía
});

test('(i) /privacidad se lee sin JavaScript y #supresion lleva a su sección; el login enlaza a ella', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/privacidad#supresion');
  await expect(page.locator('#supresion')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /iniciar sesión|bandeja|entrar/i })).toHaveCount(0); // sin menú de la aplicación
  await ctx.close();
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto('/login');
  await p2.getByRole('link', { name: 'Privacidad' }).click();
  await expect(p2).toHaveURL(/\/privacidad/);
});

test('acceso: credenciales malas → mensaje en español; ruta protegida sin sesión → /login; ¿olvidaste la contraseña?', async ({ page }) => {
  await page.goto('/contactos');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/Pídele un enlace (nuevo )?a la administradora/)).toBeVisible();
  await page.getByLabel('Correo').fill(CRISTINA.email);
  await page.getByLabel('Contraseña').fill('contraseña-equivocada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText(/incorrectos/i);
  await expect(page).toHaveURL(/\/login/);
});

test('el título de la pestaña lleva el contador de no leídos y el cierre de sesión devuelve al login', async ({ page }) => {
  await login(page, CRISTINA);
  const p = phone();
  await inboundText(p.wa, 'Contador de la pestaña', `Contador ${p.wa.slice(-6)}`);
  await expect(page).toHaveTitle(/^\(\d+\) Gelado WhatsApp/, { timeout: 5000 });
  await logout(page);
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/bandeja');
  await expect(page).toHaveURL(/\/login/);
});

test('sesión caducada: si la cookie desaparece, la app devuelve al login en vez de quedarse rota', async ({ page, context }) => {
  await login(page, CRISTINA);
  await context.clearCookies();
  await page.getByRole('link', { name: 'Contactos' }).click({ timeout: 3000 }).catch(() => undefined); // puede haber redirigido ya solo
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

test('el enlace de nueva contraseña de un solo uso: crear contraseña, entrar y no poder reutilizarlo', async ({ page }) => {
  const admin = await api();
  const email = `nueva${Date.now()}@gelado.eu`;
  const inv = await json(await admin.post('/api/users', { data: { email, name: 'Persona Nueva', role: 'AGENT' } }));
  const url = new URL(inv.link.url);
  await page.goto(url.pathname);
  await expect(page.getByText(`Crea la contraseña para`)).toBeVisible();
  // F-16: saludo neutro, sin género
  await expect(page.getByText('Te damos la bienvenida, Persona Nueva')).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill('una-clave-larga-123');
  await page.getByLabel('Repite la contraseña').fill('una-clave-distinta');
  await page.getByRole('button', { name: 'Crear contraseña' }).click();
  await expect(page.getByRole('alert')).toContainText('Las contraseñas no coinciden');
  await page.getByLabel('Repite la contraseña').fill('una-clave-larga-123');
  await page.getByRole('button', { name: 'Crear contraseña' }).click();
  await expect(page.getByText('Contraseña guardada')).toBeVisible();
  await page.getByRole('link', { name: 'Entrar' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('una-clave-larga-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/bandeja/);
  // el enlace ya no vale
  const again = await page.request.get(`/api/auth/token/${url.pathname.split('/').pop()}`);
  expect((await again.json()).valid).toBe(false);
  await admin.dispose();
});

test.describe('(j) móvil 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('lista → conversación → atrás, con la ficha y sin desbordes horizontales', async ({ page }) => {
    const p = phone();
    const name = `Móvil ${p.wa.slice(-6)}`;
    await login(page, CRISTINA);
    await inboundText(p.wa, 'Hola desde el móvil, ¿tenéis cera depilatoria?', name);
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const inbox = page.locator('.inbox');
    await expect(inbox).toHaveAttribute('data-mobile-view', 'list');
    const card = page.getByRole('list', { name: 'Lista de conversaciones' }).getByRole('link', { name: new RegExp(name) });
    await expect(card).toBeVisible({ timeout: 5000 });
    await noOverflow();
    await card.click();
    await expect(inbox).toHaveAttribute('data-mobile-view', 'chat');
    await expect(page.getByRole('main', { name: /^Conversación con/ })).toBeVisible();
    await expect(page.getByText('Ventana abierta')).toBeVisible();
    await expect(page.getByLabel('Escribe un mensaje')).toBeVisible();
    await noOverflow();
    // responder desde el móvil (Enter no envía en pantallas táctiles: se usa el botón)
    await page.getByLabel('Escribe un mensaje').fill('Sí, tenemos cera tibia y en roll-on');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('main', { name: /^Conversación con/ }).getByText('Sí, tenemos cera tibia y en roll-on')).toHaveCount(1);
    // atrás → lista
    await page.getByRole('button', { name: 'Volver a la bandeja' }).click();
    await expect(inbox).toHaveAttribute('data-mobile-view', 'list');
    await expect(card).toBeVisible();
    // menú de más opciones: Calidad y Ajustes (admin) en el menú «Más»
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /Cerrar sesión/ })).toBeVisible();
    await expect(page.getByRole('menu').getByRole('link', { name: /Calidad y costes/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/j-movil-lista.png' });
  });

  test('otras pantallas caben en 390 px: contactos, campañas y plantillas', async ({ page }) => {
    await login(page, CRISTINA);
    for (const url of ['/contactos', '/campanas', '/plantillas', '/calidad']) {
      await page.goto(url);
      await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      expect(w.sw, `${url} desborda: ${w.sw} > ${w.iw}`).toBeLessThanOrEqual(w.iw + 1);
    }
  });
});

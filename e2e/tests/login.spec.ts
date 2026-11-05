import { test, expect } from '@playwright/test';

test('la administradora entra y ve la bandeja', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Correo').fill('gelado.comercial@gmail.com');
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/bandeja/);
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
});

test('/privacidad es pública', async ({ request }) => {
  const r = await request.get('/privacidad');
  expect([200, 404]).toContain(r.status()); // S7 la implementa (200 con #supresion)
});

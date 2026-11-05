import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/** Guarda capturas numeradas (01-nombre.png…) en docs/trabajo/capturas/recorridos/<recorrido>/. */
export function capturas(recorrido: 'agente' | 'admin') {
  const dir = path.resolve(__dirname, '../docs/trabajo/capturas/recorridos', recorrido);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (page: Page, nombre: string, opts: { fullPage?: boolean } = {}) => {
    n += 1;
    await page.waitForTimeout(350); // deja acabar animaciones y el tiempo real
    await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${nombre}.png`), fullPage: opts.fullPage ?? false });
  };
}

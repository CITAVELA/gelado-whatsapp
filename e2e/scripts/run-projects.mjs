// Ejecuta el e2e proyecto a proyecto (chromium, firefox, webkit, pixel-7, iphone-14), con la BD e2e recién preparada
// antes de cada uno: las pruebas crean datos y no deben chocar entre navegadores.
//   pnpm test:e2e                                  → los cinco proyectos
//   pnpm test:e2e --project=webkit                 → uno solo (también --project=webkit,firefox o E2E_PROJECTS=webkit)
//   pnpm test:e2e --project=pixel-7 tests/01-bandeja.spec.ts -g "(d)"   → el resto de argumentos va a `playwright test`
import { spawnSync } from 'node:child_process';

const ALL = ['chromium', 'firefox', 'webkit', 'pixel-7', 'iphone-14'];
const rest = [];
let wanted = (process.env.E2E_PROJECTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--project') wanted.push(...String(argv[++i] ?? '').split(','));
  else if (a.startsWith('--project=')) wanted.push(...a.slice('--project='.length).split(','));
  else rest.push(a);
}
wanted = [...new Set(wanted.map((s) => s.trim()).filter(Boolean))];
const projects = wanted.length ? wanted : ALL;
const bad = projects.filter((p) => !ALL.includes(p));
if (bad.length) { console.error(`Proyecto desconocido: ${bad.join(', ')}. Disponibles: ${ALL.join(', ')}`); process.exit(2); }

const cwd = new URL('..', import.meta.url).pathname;
const results = [];
for (const p of projects) {
  console.log(`\n=== e2e · proyecto ${p} ===`);
  const prep = spawnSync('node', ['scripts/prepare-db.mjs'], { cwd, encoding: 'utf8' });
  if (prep.status !== 0) { console.error(prep.stdout, prep.stderr); results.push([p, 'error al preparar la BD']); continue; }
  const run = spawnSync('npx', ['playwright', 'test', `--project=${p}`, ...rest], { cwd, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_HTML_REPORT: `playwright-report/${p}` } });
  results.push([p, run.status === 0 ? 'OK' : `FALLA (código ${run.status})`]);
}
console.log('\nResumen e2e:');
for (const [p, r] of results) console.log(`  ${p.padEnd(10)} ${r}`);
process.exit(results.every(([, r]) => r === 'OK') ? 0 : 1);

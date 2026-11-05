try {
  process.loadEnvFile(require('node:path').resolve(__dirname, '../../../../.env'));
} catch {
  /* sin .env */
}
// Arranca el simulador en desarrollo: pnpm -F @gelado/api simulator (puerto 4010 → webhook de la app en :3000)
import { MetaSimulator } from './simulator';

const port = Number(process.env.META_SIM_PORT || 4010);
const sim = new MetaSimulator({
  port,
  appSecret: process.env.META_APP_SECRET || 'sim-app-secret',
  webhookUrl: process.env.META_SIM_WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}/webhooks/whatsapp`,
});
sim.start().then(() => console.log(`Simulador de Meta en ${sim.baseUrl} (webhook → ${sim.opts.webhookUrl})`));

import 'reflect-metadata';
import { config, loadDotEnv } from './common/config';
loadDotEnv();
import { createApp } from './bootstrap';

async function main() {
  process.env.TZ = process.env.TZ || 'Europe/Madrid';
  const app = await createApp();
  app.enableShutdownHooks();
  const port = config().PORT;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Gelado WhatsApp escuchando en ${config().APP_URL} (puerto ${port}, worker ${config().WORKER_ENABLED ? 'activo' : 'apagado'})`);
}
main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

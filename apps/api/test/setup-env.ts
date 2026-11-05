// Variables de entorno de las pruebas: BD propia y simulador; nunca servicios reales.
process.env.NODE_ENV = 'test';
process.env.TZ = 'Europe/Madrid';
const testDb = process.env.TEST_DATABASE_URL || 'postgresql://gelado:gelado@localhost:5432/gelado_test?schema=app';
process.env.DATABASE_URL = testDb;
process.env.DIRECT_URL = testDb;
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = process.env.TEST_STORAGE_DIR || './storage-test';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.WA_VERIFY_TOKEN = 'test-verify-token';
process.env.WA_SYSTEM_USER_TOKEN = 'test-token';
process.env.STATUS_TOKEN = 'test-status-token';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
process.env.WORKER_ENABLED = 'false';
process.env.APP_URL = 'http://localhost:3000';
// META_GRAPH_BASE_URL la fija cada prueba que arranca el simulador (puerto aleatorio)

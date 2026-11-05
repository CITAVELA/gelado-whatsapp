import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { AppModule } from './app.module';
import { config } from './common/config';
import { AllExceptionsFilter } from './common/http-exception.filter';

/** Prefijos que NO son de la SPA. */
const SERVER_PREFIXES = ['/api', '/webhooks', '/health', '/privacidad', '/storage', '/ws'];

export async function createApp(opts: { logger?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // necesario para verificar X-Hub-Signature-256 sobre el cuerpo crudo
    logger: opts.logger === false ? false : ['log', 'warn', 'error'],
  });
  configureApp(app);
  return app;
}

export function configureApp(app: INestApplication) {
  const c = config();
  const ex = app as NestExpressApplication;
  ex.set('trust proxy', 1); // Render
  ex.disable('x-powered-by');
  // Compresión gzip de texto (JSON, HTML, JS, CSS): menos tráfico de salida en Render
  app.use(compression({ threshold: 1024, filter: (req, res) => !req.path.startsWith('/ws') && compression.filter(req, res) }));
  ex.useBodyParser('json', { limit: '5mb' });
  app.use(cookieParser());
  const storageOrigin = c.STORAGE_DRIVER === 'supabase' && c.SUPABASE_URL ? new URL(c.SUPABASE_URL).origin : '';
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', ...(storageOrigin ? [storageOrigin] : [])],
          'media-src': ["'self'", 'blob:', ...(storageOrigin ? [storageOrigin] : [])],
          'connect-src': ["'self'", 'ws:', 'wss:', ...(storageOrigin ? [storageOrigin] : [])],
          'font-src': ["'self'", 'data:'],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': c.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // SPA compilada (mismo origen, sin CORS). En desarrollo la sirve Vite con proxy.
  const webDist = c.WEB_DIST_DIR || path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    // /assets/* lleva huella en el nombre (Vite): caché de un año. El resto (favicon…) 1 h; index.html siempre revalida.
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.split(path.sep).includes('assets')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' || SERVER_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }
}

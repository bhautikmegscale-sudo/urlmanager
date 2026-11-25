import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import { ZodError } from 'zod';
import { env } from './config/env';
import { errorMessage } from './controllers/catalog.controller';
import { catalogRoutes } from './routes/catalog.routes';
import { webRoutes } from './routes/web.routes';
import { CatalogError, log } from './types/catalog.types';

export const app = express();
const source = path.resolve(__dirname, '../src');
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(source, 'views'));
app.disable('view cache');
app.use((req, res, next) => {
  const origin = req.get('origin');
  const localOrigins = [env.BASE_URL.origin, 'http://localhost:' + env.PORT, 'http://127.0.0.1:' + env.PORT];
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: http:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  if (!localOrigins.some(url => new URL(url).host === req.get('host'))) {
    res.status(403).json({ error: 'Unexpected host.' });
    return;
  }
  if (req.method === 'POST' && (req.get('sec-fetch-site') === 'cross-site' || (origin && !localOrigins.includes(origin)))) {
    res.status(403).json({ error: 'Cross-origin requests are blocked.' });
    return;
  }
  next();
});
app.use('/assets', express.static(path.join(source, 'public'), {
  cacheControl: false,
  etag: false,
  lastModified: false,
}));
app.use(express.json({ limit: '5mb' }));
app.use('/api/catalog', catalogRoutes);
app.use(webRoutes);
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request. ' + error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join(' ') });
  } else if (error instanceof CatalogError) {
    res.status(error.status).json({ error: errorMessage(error) });
  } else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(error.status).json({ error: 'Invalid JSON or request body too large.' });
  } else {
    log('Unexpected request error');
    res.status(500).json({ error: errorMessage(error) });
  }
};
app.use(handleError);

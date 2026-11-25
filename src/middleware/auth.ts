import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest();
const expected = env.APP_USERNAME && env.APP_PASSWORD.trim()
  ? digest(env.APP_USERNAME + ':' + env.APP_PASSWORD)
  : undefined;

export const requireAuthentication: RequestHandler = (req, res, next) => {
  if (!expected) {
    res.status(503).type('text').send('Set APP_USERNAME and APP_PASSWORD in .env to enable access.');
    return;
  }

  const authorization = req.get('authorization')?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i);
  if (authorization && timingSafeEqual(digest(Buffer.from(authorization[1], 'base64')), expected)) {
    next();
    return;
  }

  res.set('WWW-Authenticate', 'Basic realm="Meta Catalog", charset="UTF-8"');
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Sign in with the configured username and password.' });
  } else {
    res.status(401).type('text').send('Sign in with the configured username and password.');
  }
};

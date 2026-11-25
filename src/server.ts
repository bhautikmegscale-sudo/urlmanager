import { app } from './app';
import { env } from './config/env';
import { log } from './types/catalog.types';

app.listen(env.PORT, '127.0.0.1', () => log('Server listening', { port: env.PORT }));

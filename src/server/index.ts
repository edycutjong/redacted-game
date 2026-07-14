/**
 * Server entry — a Hono app served over the Devvit server runtime. Vite bundles
 * this to dist/server/index.cjs (see @devvit/start/vite). Routes are registered
 * from thin adapter modules; all game logic lives in the pure cores + Store.
 */

import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/server';
import { registerApiRoutes } from './routes/api';
import { registerInternalRoutes } from './routes/internal';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
registerApiRoutes(app);
registerInternalRoutes(app);

createServer(getRequestListener(app.fetch)).listen(getServerPort());

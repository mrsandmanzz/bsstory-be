import { serve } from '@hono/node-server';
import { getContainer } from './container.js';
import { createApp } from './http/app.js';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(getContainer).fetch, port }, () => console.log(`API ready on http://localhost:${port}`));

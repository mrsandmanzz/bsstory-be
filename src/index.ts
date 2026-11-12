import { getContainer } from './container.js';
import { createApp } from './http/app.js';

/**
 * Vercel's zero-config Hono entry: the default export is the app. Vercel turns it into a function; locally,
 * `src/dev.ts` serves the same app with @hono/node-server.
 */
export default createApp(getContainer);

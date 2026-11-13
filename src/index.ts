import { type Hono } from 'hono';
import { getContainer } from './container.js';
import { type Env, createApp } from './http/app.js';

/**
 * Vercel's zero-config Hono entry: the default export is the app. Vercel turns it into a function; locally,
 * `src/dev.ts` serves the same app with @hono/node-server.
 *
 * Vercel only recognises an entry file that imports the `hono` package itself (its docs: "create a file that imports
 * the hono package" at src/index.ts and similar paths). Importing only our own modules is not enough: the deployment
 * then builds without a function and answers every route with Vercel's own 404. The explicit type below keeps that
 * import in place on purpose.
 */
const app: Hono<Env> = createApp(getContainer);

export default app;

import { Hono } from 'hono';
import { getContainer } from './container.js';
import { type Env, createApp } from './http/app.js';

/**
 * Vercel's zero-config Hono entry: the default export is the app. Vercel turns it into a function; locally,
 * `src/dev.ts` serves the same app with @hono/node-server.
 *
 * Vercel only builds a function when this entry file really imports and uses the `hono` package. A type-only import
 * is erased at compile time and does not count: the deployment then finishes in seconds without a function and answers
 * every route with Vercel's own 404. So the entry creates a real Hono app and mounts ours on it.
 */
const app = new Hono<Env>();
app.route('/', createApp(getContainer));

export default app;

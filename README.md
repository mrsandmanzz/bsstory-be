# bookstory-be

Backend for **MainStory**, a paid digital storybook library for toddlers. One subscription unlocks every book, and a one-time purchase unlocks a single book for good.

Web app: [bookstory](https://github.com/sandmanzz/bookstory)

## Stack

Node.js 22, [Hono](https://hono.dev), PostgreSQL ([Supabase](https://supabase.com) in production, [PGlite](https://pglite.dev), PostgreSQL running inside Node, locally and in tests), zod for validation, jose for the JWT, TypeScript in strict mode, Vitest.

## Run locally

```bash
npm install
npm run dev        # API on http://localhost:8787
npm run check      # lint, format check, strict typecheck and all tests
```

There is nothing to install for the database: locally it is PostgreSQL running inside the Node process (PGlite), created and seeded on the first request in `data/dev` (git-ignored). Delete that folder to reset the demo data. Settings are read from environment variables (`.env.example` lists them all), for example `PORT=8899 npm run dev`. The app does not read a `.env` file by itself.

Demo accounts (log in with the email only, this is a mock login): `parent@mainstory.test` (no subscription), `subscriber@mainstory.test` (subscribed), `admin@mainstory.test` (admin).

Test cards for the mock payment gateway: `4242 4242 4242 4242` works, `4000 0000 0000 0002` is declined, `4000 0000 0000 9995` has insufficient funds, `4000 0000 0000 0069` is expired.

## What it does

- **Books:** CRUD for admins, with validation. A book has pages, optional stickers and a question per page, and optional Indonesian translations.
- **Access control:** a subscription opens every book, a purchase opens that book forever, a free book is open to everyone, and anything else shows only a preview. Locked text, stickers and answer keys are never sent to the client. The rules live in `src/domain/access.ts`.
- **Mock payments:** subscription (with a 7-day free trial) and one-time book purchase, with idempotency keys, a reservation before every charge, and lazy renewal.
- **Launch offer:** a time-limited discount on the first subscription payment, with a real end time. The price shown at checkout is checked on the server.
- **Recommendations:** `GET /v1/books/:slug/next` suggests what to read after a story.

Layers: `src/http` (routes and validation) → `src/services` (business rules) → `src/repositories` (SQL). `src/domain` holds the pure rules, `src/payments` the mock gateway, `src/container.ts` wires everything together.

## API

All responses are JSON. Errors look like `{ "error": { "code", "message", "details" } }`. Auth is `Authorization: Bearer <token>`.

| Method and path                                                  | Auth     | Purpose                                         |
| ---------------------------------------------------------------- | -------- | ----------------------------------------------- |
| `GET /health`, `GET /v1/meta`                                    | none     | Liveness, demo accounts and test cards          |
| `POST /v1/auth/login`                                            | none     | Mock login, creates the user on first use       |
| `GET /v1/me`                                                     | user     | Account, subscription, owned books              |
| `GET /v1/books`, `GET /v1/books/:key`                            | optional | Catalog and one book, with per-user access      |
| `GET /v1/books/:key/read`                                        | optional | The content gate: full pages or the preview     |
| `GET /v1/books/:key/next`                                        | optional | Next-book suggestions                           |
| `POST /v1/books`, `PUT` and `DELETE /v1/books/:key`              | admin    | Manage books (deleting a sold book archives it) |
| `GET /v1/plans`                                                  | none     | Plans, offer prices and the server clock        |
| `POST /v1/checkout/subscription`, `POST /v1/checkout/books/:key` | user     | Pay (send an `Idempotency-Key` header)          |
| `POST /v1/subscription/cancel`, `POST /v1/subscription/resume`   | user     | Cancel at period end, or undo it                |
| `GET /v1/billing/history`                                        | user     | Payments and purchases                          |

## Settings

| Variable                                        | Notes                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                                  | The Supabase connection string (`postgresql://...`). Required in production. |
| `JWT_SECRET`, `ADMIN_EMAILS`                    | Required in production: the API refuses to start without them.               |
| `ALLOWED_ORIGINS`                               | Comma-separated web origins for CORS.                                        |
| `AUTO_SEED`                                     | `true` seeds the demo data into an empty database.                           |
| `PROMO_PERCENT`, `PROMO_ENDS_AT`, `PROMO_LABEL` | The launch offer. There is none in production unless the first two are set.  |

## Deploy on Vercel with Supabase

1. In Supabase, create a project and set a database password.
2. In the project's connection settings, copy the **Transaction pooler** connection string (port 6543). Serverless functions open many short connections, and the pooler is what Supabase provides for that. If the password has special characters, URL-encode them.
3. Import this repository in Vercel. The entry point is `src/index.ts` (`export default app`), so no build command is needed.
4. In Vercel, set `DATABASE_URL` to that string, plus `JWT_SECRET`, `ADMIN_EMAILS` and `AUTO_SEED=true`, then deploy. Keep the connection string out of git and out of chat.
5. Check it: `npm run smoke -- https://<your-api>` (read-only), and once with `--write` to prove the database accepts writes.

The first request creates the tables and seeds the demo data, so it can take a few seconds. The schema script also turns on row level security for every table, which closes Supabase's public REST API to them: only this server's own connection can read or write.

The `postgres://` path is tested against a PostgreSQL server speaking the real wire protocol (`test/postgres-driver.test.ts`), but this API has **not been deployed or verified on Vercel and Supabase yet**.

## Documentation

In [`docs/`](docs): the product thinking and system design write-up ([Markdown](docs/PRODUCT_THINKING_AND_SYSTEM_DESIGN.md), [PDF](docs/MainStory_Product_Thinking_and_System_Design.pdf)) and the [slides](docs/MainStory_Product_Slides.pdf).

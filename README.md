# Cloud Data Server

A Node.js + Express REST API that stores data in a PostgreSQL database.
Run it on any cloud host and point it at your own Postgres server or a hosted
one (Supabase, Neon, Render, Railway, AWS RDS, ...).

Data is stored as JSON documents grouped into **collections**. You can store
any shape of data (users, notes, orders, sensor readings) without changing the schema.

## Quick start (local)

1. Install Node.js 18+ and PostgreSQL.
2. Create a database:
   ```bash
   createdb cloud_data
   ```
3. Configure and run:
   ```bash
   npm install
   cp .env.example .env     # then edit DATABASE_URL
   npm start
   ```
4. Check it: `curl http://localhost:3000/health`

The `items` table is created automatically on startup. You can also run `npm run migrate` to create it yourself.

## Configuration (`.env`)

| Variable       | Purpose                                                         |
|----------------|-----------------------------------------------------------------|
| `PORT`         | Port to listen on (default `3000`; most hosts set this)         |
| `DATABASE_URL` | Postgres connection string (**required**)                       |
| `DATABASE_SSL` | `true` for hosted databases that require SSL                    |
| `API_KEY`      | If set, clients must send it in the `x-api-key` header          |
| `CORS_ORIGIN`  | Allowed browser origin (default `*`)                            |

**Set `API_KEY` before deploying publicly.** Without it, anyone can read and write your data.

## API

All `/api` routes take and return JSON.

| Method | Path                  | Description                                          |
|--------|-----------------------|------------------------------------------------------|
| GET    | `/health`             | Server and database status                           |
| GET    | `/api/items`          | List items (`?collection=`, `?limit=`, `?offset=`)   |
| GET    | `/api/items/:id`      | Get one item                                         |
| POST   | `/api/items`          | Create: `{ "collection": "notes", "data": {...} }`   |
| PUT    | `/api/items/:id`      | Replace data: `{ "data": {...} }`                    |
| PATCH  | `/api/items/:id`      | Merge fields into data: `{ "data": {...} }`          |
| DELETE | `/api/items/:id`      | Delete an item                                       |

Example:

```bash
curl -X POST http://localhost:3000/api/items \
  -H "content-type: application/json" -H "x-api-key: YOUR_KEY" \
  -d '{"collection":"notes","data":{"title":"hello"}}'
```

## Deploying to the cloud

**Option A: your own server (VPS such as DigitalOcean, Linode, EC2)**
1. Install Node.js and PostgreSQL on the server, then create the database.
2. Clone this repo, `npm install --omit=dev`, create `.env`.
3. Keep it running with a process manager: `npx pm2 start src/index.js --name cloud-data`.
4. Put Nginx or Caddy in front for HTTPS.

**Option B: a platform host (Render, Railway, Fly.io, Heroku)**
1. Create a Postgres database on the platform (or use Supabase/Neon).
2. Create a web service from this repo with build command `npm install` and start command `npm start`.
3. Set `DATABASE_URL`, `DATABASE_SSL=true` and `API_KEY` as environment variables.

## Tests

The tests need a throwaway Postgres database:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cloud_data npm test
```

## Project layout

```
src/
  index.js        start-up: migrate, then listen
  app.js          Express app, middleware, API-key check, errors
  config.js       environment variables
  db.js           Postgres connection pool
  migrate.js      database schema
  routes/items.js CRUD endpoints
test/             integration tests
```

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
| `MCP_KEY`      | Separate key for the MCP endpoint; `/mcp` is off when unset     |
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

## MCP server (for Claude Desktop and other AI apps)

The server also has an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`.
It lets AI apps work with your data directly. It has **its own key**, `MCP_KEY`,
which is separate from `API_KEY`. You can give an AI app access without sharing your API key,
and change either key without affecting the other.

1. Generate a key and put it in `.env` as `MCP_KEY`:
   ```bash
   npm run gen-key
   ```
2. Restart the server. `/mcp` is only turned on when `MCP_KEY` is set.

Clients send the key as `Authorization: Bearer <MCP_KEY>` (or in an `x-mcp-key` header).

**Tools the AI gets:**

| Tool               | What it does                                                    |
|--------------------|-----------------------------------------------------------------|
| `list_collections` | Lists collections and how many items each holds                 |
| `list_items`       | Lists items; filter by collection and by field values           |
| `get_item`         | Gets one item by id                                             |
| `create_item`      | Creates an item                                                 |
| `update_item`      | Merges fields into an item, or replaces its data                |
| `delete_item`      | Deletes an item                                                 |

**Connect Claude Desktop:** open Settings → Developer → Edit Config, and add the following to
`claude_desktop_config.json`. Replace the URL and the key, then restart Claude Desktop.
Node.js must be installed on that computer.

```json
{
  "mcpServers": {
    "cloud-data": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://YOUR-SERVER/mcp",
        "--header", "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer YOUR_MCP_KEY" }
    }
  }
}
```

**Connect Claude Code:**

```bash
claude mcp add --transport http cloud-data https://YOUR-SERVER/mcp --header "Authorization: Bearer YOUR_MCP_KEY"
```

Use HTTPS for a public server, so the key is not sent in plain text.

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
  store.js        database queries shared by REST and MCP
  mcp.js          MCP endpoint, its tools and the MCP_KEY check
  routes/items.js CRUD endpoints
test/             integration tests
```

# Cloud Data Server

A Node.js + Express server for storing data in a PostgreSQL database, with
user accounts, a web dashboard, a REST API, and an MCP endpoint for AI apps such as Claude Desktop.

Run it on any cloud host and point it at your own Postgres server or a hosted
one (Supabase, Neon, Render, Railway, AWS RDS, ...).

**Features**
- **Accounts:** sign up, log in, log out, change password, edit profile, delete account
- **Private data:** every user only sees and changes their own items
- **Collections of JSON items:** store any shape of data; filter, sort, page, bulk-create, rename and delete collections
- **Personal API keys:** for scripts, apps and MCP; create and revoke each one separately
- **Signed-in devices:** see your sessions and sign out the others
- **Export:** download all your data as JSON
- **Admin:** the first account is the admin; admins see stats and manage users
- **Web dashboard** at `/`, usable on phones too
- **MCP endpoint** at `/mcp`, so AI apps can work with your data
- **Security:** scrypt password hashing, tokens stored only as hashes, rate limits on login and the API, secure HTTP headers

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
4. Open http://localhost:3000 and create an account. **The first account becomes the admin.**

Database tables are created and upgraded automatically on startup (`npm run migrate` does the same on its own).

## Configuration (`.env`)

| Variable             | Purpose                                                              |
|----------------------|----------------------------------------------------------------------|
| `PORT`               | Port to listen on (default `3000`; most hosts set this)              |
| `DATABASE_URL`       | Postgres connection string (**required**)                            |
| `DATABASE_SSL`       | `true` for hosted databases that require SSL                         |
| `ALLOW_REGISTRATION` | `false` stops new sign-ups (default `true`)                          |
| `SESSION_TTL_DAYS`   | How long a login lasts (default `30`)                                |
| `TRUST_PROXY`        | Set to `1` behind a load balancer/proxy so rate limits see real IPs  |
| `CORS_ORIGIN`        | Allowed browser origin (default `*`)                                 |

Tip: after you create your own account, set `ALLOW_REGISTRATION=false` if the server is only for you or invited people.

## Signing in to the API

Every `/api` request (except sign-up and login) needs a token:

```
Authorization: Bearer <token>
```

The token can be either:
- a **login session** (`cds_...`) from `/api/auth/login` or `/api/auth/register`, which expires after `SESSION_TTL_DAYS`
- a **personal API key** (`cdk_...`) created in the dashboard or with `POST /api/account/keys`, which lasts until revoked

```bash
# Create an account (returns a token)
curl -X POST http://localhost:3000/api/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"a long password","name":"You"}'

# Use the token
curl http://localhost:3000/api/items -H "Authorization: Bearer cds_..."
```

## API

### Accounts

| Method | Path                         | Description                                              |
|--------|------------------------------|----------------------------------------------------------|
| POST   | `/api/auth/register`         | Sign up: `{ email, password, name? }` → `{ token, user }` |
| POST   | `/api/auth/login`            | Log in: `{ email, password }` → `{ token, user }`         |
| POST   | `/api/auth/logout`           | End the current session                                   |
| GET    | `/api/account`               | Your profile                                              |
| PATCH  | `/api/account`               | Update `{ name?, email? }`                                |
| POST   | `/api/account/password`      | `{ current_password, new_password }`; signs out other devices |
| DELETE | `/api/account`               | Delete account and all data: `{ password }`               |
| GET    | `/api/account/export`        | Download all your items as JSON                           |
| GET    | `/api/account/sessions`      | Your signed-in devices                                    |
| DELETE | `/api/account/sessions`      | Sign out all other devices                                |
| GET    | `/api/account/keys`          | List your API keys (secrets are never shown again)        |
| POST   | `/api/account/keys`          | Create a key: `{ name }`; the response includes the key **once** |
| DELETE | `/api/account/keys/:id`      | Revoke a key                                              |

### Data

| Method | Path                         | Description                                              |
|--------|------------------------------|----------------------------------------------------------|
| GET    | `/api/items`                 | List items (see query options below)                     |
| GET    | `/api/items/:id`             | Get one item                                             |
| POST   | `/api/items`                 | Create: `{ "collection": "notes", "data": {...} }`       |
| POST   | `/api/items/bulk`            | Create up to 500: `{ "collection": "notes", "items": [{...}, ...] }` |
| PUT    | `/api/items/:id`             | Replace data: `{ "data": {...} }`                        |
| PATCH  | `/api/items/:id`             | Merge fields into data: `{ "data": {...} }`              |
| DELETE | `/api/items/:id`             | Delete an item                                           |
| GET    | `/api/collections`           | Your collections with item counts                        |
| PATCH  | `/api/collections/:name`     | Rename: `{ "name": "new-name" }`                         |
| DELETE | `/api/collections/:name`     | Delete a collection and all its items                    |

`GET /api/items` query options:

| Option       | Example                         | Meaning                                         |
|--------------|---------------------------------|-------------------------------------------------|
| `collection` | `notes`                         | Only this collection                            |
| `where`      | `{"status":"open"}` (URL-encoded) | Only items whose data contains these values    |
| `sort`       | `created_at` or `updated_at`    | Sort field                                      |
| `order`      | `asc` or `desc`                 | Sort direction (default `desc`)                 |
| `limit`      | `20`                            | Page size (1–500, default 50)                   |
| `offset`     | `40`                            | Items to skip                                   |

The response is `{ items, total, limit, offset }`.

### Admin (admins only)

| Method | Path                     | Description                              |
|--------|--------------------------|------------------------------------------|
| GET    | `/api/admin/stats`       | Counts of users, items, sessions, keys   |
| GET    | `/api/admin/users`       | List users with item counts              |
| PATCH  | `/api/admin/users/:id`   | Change role: `{ "role": "admin" }`       |
| DELETE | `/api/admin/users/:id`   | Delete a user and their data             |

### Other

| Method | Path      | Description                 |
|--------|-----------|-----------------------------|
| GET    | `/health` | Server and database status  |

## MCP server (for Claude Desktop and other AI apps)

The `/mcp` endpoint lets AI apps work with your data as tools. Each person connects
with **their own personal API key**, and the AI only sees that person's data.

1. In the dashboard, open **Account → API keys** and create a key, e.g. "Claude Desktop".
2. The dashboard shows a ready-made Claude Desktop config with your server address and key filled in.
   Paste it into Claude Desktop (Settings → Developer → Edit Config) and restart Claude Desktop.
   Node.js must be installed on that computer.

The config looks like this:

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
      "env": { "AUTH_HEADER": "Bearer cdk_YOUR_KEY" }
    }
  }
}
```

**Connect Claude Code:**

```bash
claude mcp add --transport http cloud-data https://YOUR-SERVER/mcp --header "Authorization: Bearer cdk_YOUR_KEY"
```

**Tools the AI gets:** `list_collections`, `list_items` (filter, sort, page), `get_item`,
`create_item`, `create_items` (bulk), `update_item` (merge or replace), `delete_item`.

Revoking the key in the dashboard cuts off that app immediately. Login session tokens are not
accepted on `/mcp`, only API keys.

## Deploying to the cloud

Always use HTTPS for a public server, so passwords and keys are not sent in plain text.

**Option A: your own server (VPS such as DigitalOcean, Linode, EC2)**
1. Install Node.js and PostgreSQL on the server, then create the database.
2. Clone this repo, `npm install --omit=dev`, create `.env`.
3. Keep it running with a process manager: `npx pm2 start src/index.js --name cloud-data`.
4. Put Nginx or Caddy in front for HTTPS, and set `TRUST_PROXY=1`.

**Option B: a platform host (Render, Railway, Fly.io, Heroku)**
1. Create a Postgres database on the platform (or use Supabase/Neon).
2. Create a web service from this repo with build command `npm install` and start command `npm start`.
3. Set `DATABASE_URL`, `DATABASE_SSL=true` and `TRUST_PROXY=1` as environment variables.

## Upgrading from the version without accounts

Start the new version and the database upgrades itself. Items saved before accounts existed
are given to the first account you create (the admin).

## Tests

The tests need a throwaway Postgres database:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cloud_data npm test
```

## Project layout

```
public/            web dashboard (index.html, app.js, style.css)
src/
  index.js         start-up: migrate, listen, clean up expired sessions
  app.js           Express app, rate limits, routes, errors
  config.js        environment variables
  db.js            Postgres connection pool
  migrate.js       versioned database migrations
  auth.js          password hashing, tokens, sign-in middleware
  users.js         account and token queries
  store.js         item queries (shared by REST and MCP)
  mcp.js           MCP endpoint and its tools
  routes/          auth, account, admin and item endpoints
test/              integration tests
```

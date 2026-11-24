// Versioned database migrations. Each one runs once, in order, inside a
// transaction. Add new migrations to the end of the list; never edit old ones.
const db = require('./db');

const MIGRATIONS = [
  {
    id: 1,
    name: 'items',
    sql: `
      CREATE TABLE IF NOT EXISTS items (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection  TEXT NOT NULL,
        data        JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS items_collection_idx ON items (collection, created_at DESC);
      CREATE INDEX IF NOT EXISTS items_data_idx ON items USING GIN (data);
    `,
  },
  {
    id: 2,
    name: 'users_tokens_and_item_owners',
    sql: `
      CREATE TABLE users (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email          TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL DEFAULT '',
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Login sessions and personal API keys. Only a SHA-256 hash of each token is stored.
      CREATE TABLE tokens (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('session', 'api_key')),
        name          TEXT NOT NULL DEFAULT '',
        token_hash    TEXT NOT NULL UNIQUE,
        prefix        TEXT NOT NULL,
        expires_at    TIMESTAMPTZ,
        last_used_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX tokens_user_idx ON tokens (user_id, kind);

      ALTER TABLE items ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE CASCADE;
      DROP INDEX IF EXISTS items_collection_idx;
      CREATE INDEX items_owner_collection_idx ON items (owner_id, collection, created_at DESC);
    `,
  },
];

async function migrate() {
  const client = await db.pool.connect();
  try {
    // Stops two server instances from migrating at the same time.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         INT PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.id));

    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await client.query('COMMIT');
        console.log(`Applied migration ${m.id}: ${m.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.id} (${m.name}) failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migrations up to date');
      return db.pool.end();
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

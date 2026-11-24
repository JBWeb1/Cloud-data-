const db = require('./db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection  TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_collection_idx ON items (collection, created_at DESC);
CREATE INDEX IF NOT EXISTS items_data_idx ON items USING GIN (data);
`;

async function migrate() {
  await db.query(SCHEMA);
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration complete');
      return db.pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

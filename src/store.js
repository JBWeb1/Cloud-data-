// Data access shared by the REST API and the MCP server.
const db = require('./db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTION_RE = /^[A-Za-z0-9_-]{1,64}$/;

function clampLimit(limit) {
  return Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
}

function clampOffset(offset) {
  return Math.max(parseInt(offset, 10) || 0, 0);
}

async function listItems({ collection, where, limit, offset } = {}) {
  const lim = clampLimit(limit);
  const off = clampOffset(offset);
  const params = [];
  const conditions = [];
  if (collection) {
    params.push(collection);
    conditions.push(`collection = $${params.length}`);
  }
  if (where) {
    // JSON containment: matches items whose data includes all the given fields.
    params.push(where);
    conditions.push(`data @> $${params.length}::jsonb`);
  }
  params.push(lim, off);
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM items ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, limit: lim, offset: off };
}

async function listCollections() {
  const { rows } = await db.query(
    'SELECT collection, COUNT(*)::int AS count FROM items GROUP BY collection ORDER BY collection',
  );
  return rows;
}

async function getItem(id) {
  const { rows } = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createItem(collection, data) {
  const { rows } = await db.query(
    'INSERT INTO items (collection, data) VALUES ($1, $2) RETURNING *',
    [collection, data],
  );
  return rows[0];
}

async function replaceItem(id, data) {
  const { rows } = await db.query(
    'UPDATE items SET data = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, data],
  );
  return rows[0] || null;
}

async function mergeItem(id, data) {
  const { rows } = await db.query(
    'UPDATE items SET data = data || $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *',
    [id, data],
  );
  return rows[0] || null;
}

async function deleteItem(id) {
  const { rowCount } = await db.query('DELETE FROM items WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  UUID_RE,
  COLLECTION_RE,
  listItems,
  listCollections,
  getItem,
  createItem,
  replaceItem,
  mergeItem,
  deleteItem,
};

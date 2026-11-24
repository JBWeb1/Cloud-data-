// Item queries shared by the REST API and the MCP server.
// Every function takes the owner's user id, so users only ever see their own data.
const db = require('./db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SORT_FIELDS = new Set(['created_at', 'updated_at']);
const MAX_BULK = 500;

const FIELDS = 'id, collection, data, created_at, updated_at';

function clampLimit(limit) {
  return Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
}

function clampOffset(offset) {
  return Math.max(parseInt(offset, 10) || 0, 0);
}

/**
 * Lists a user's items.
 * - collection: only this collection
 * - where: only items whose data contains these fields/values (JSON containment)
 * - sort: created_at | updated_at, order: asc | desc
 */
async function listItems(ownerId, { collection, where, sort, order, limit, offset } = {}) {
  const lim = clampLimit(limit);
  const off = clampOffset(offset);
  const sortField = SORT_FIELDS.has(sort) ? sort : 'created_at';
  const direction = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const params = [ownerId];
  const conditions = ['owner_id = $1'];
  if (collection) {
    params.push(collection);
    conditions.push(`collection = $${params.length}`);
  }
  if (where && Object.keys(where).length) {
    params.push(where);
    conditions.push(`data @> $${params.length}::jsonb`);
  }
  const whereSql = conditions.join(' AND ');

  const [{ rows }, count] = await Promise.all([
    db.query(
      `SELECT ${FIELDS} FROM items WHERE ${whereSql}
       ORDER BY ${sortField} ${direction}, id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, off],
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM items WHERE ${whereSql}`, params),
  ]);
  return { items: rows, total: count.rows[0].n, limit: lim, offset: off };
}

async function listCollections(ownerId) {
  const { rows } = await db.query(
    `SELECT collection, COUNT(*)::int AS count, MAX(updated_at) AS last_updated
     FROM items WHERE owner_id = $1 GROUP BY collection ORDER BY collection`,
    [ownerId],
  );
  return rows;
}

async function getItem(ownerId, id) {
  const { rows } = await db.query(`SELECT ${FIELDS} FROM items WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  return rows[0] || null;
}

async function createItem(ownerId, collection, data) {
  const { rows } = await db.query(
    `INSERT INTO items (owner_id, collection, data) VALUES ($1, $2, $3) RETURNING ${FIELDS}`,
    [ownerId, collection, data],
  );
  return rows[0];
}

/**
 * Inserts many items into one collection in a single statement.
 * clock_timestamp() gives each row its own, increasing time so sorting
 * by created_at keeps the order the items were sent in.
 */
async function createItems(ownerId, collection, dataList) {
  const { rows } = await db.query(
    `INSERT INTO items (owner_id, collection, data, created_at, updated_at)
     SELECT $1, $2, e.d, clock_timestamp(), clock_timestamp()
     FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS e(d, n)
     ORDER BY e.n
     RETURNING ${FIELDS}`,
    [ownerId, collection, JSON.stringify(dataList)],
  );
  return rows;
}

async function replaceItem(ownerId, id, data) {
  const { rows } = await db.query(
    `UPDATE items SET data = $3, updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING ${FIELDS}`,
    [id, ownerId, data],
  );
  return rows[0] || null;
}

async function mergeItem(ownerId, id, data) {
  const { rows } = await db.query(
    `UPDATE items SET data = data || $3::jsonb, updated_at = now()
     WHERE id = $1 AND owner_id = $2 RETURNING ${FIELDS}`,
    [id, ownerId, data],
  );
  return rows[0] || null;
}

async function deleteItem(ownerId, id) {
  const { rowCount } = await db.query('DELETE FROM items WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return rowCount > 0;
}

async function deleteCollection(ownerId, collection) {
  const { rowCount } = await db.query(
    'DELETE FROM items WHERE owner_id = $1 AND collection = $2',
    [ownerId, collection],
  );
  return rowCount;
}

async function renameCollection(ownerId, from, to) {
  const { rowCount } = await db.query(
    'UPDATE items SET collection = $3 WHERE owner_id = $1 AND collection = $2',
    [ownerId, from, to],
  );
  return rowCount;
}

/** All of a user's items, for backup/export. */
async function exportItems(ownerId, collection) {
  const params = [ownerId];
  let extra = '';
  if (collection) {
    params.push(collection);
    extra = 'AND collection = $2';
  }
  const { rows } = await db.query(
    `SELECT ${FIELDS} FROM items WHERE owner_id = $1 ${extra} ORDER BY collection, created_at`,
    params,
  );
  return rows;
}

module.exports = {
  UUID_RE,
  COLLECTION_RE,
  MAX_BULK,
  listItems,
  listCollections,
  getItem,
  createItem,
  createItems,
  replaceItem,
  mergeItem,
  deleteItem,
  deleteCollection,
  renameCollection,
  exportItems,
};
